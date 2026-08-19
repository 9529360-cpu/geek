'use strict';

// Minimal QR encoder for the website's 34-character TRON payment address.
// Fixed profile: QR Version 3, error correction M, byte mode, mask 0.
const VERSION = 3;
const SIZE = VERSION * 4 + 17;
const DATA_CODEWORDS = 44;
const ECC_CODEWORDS = 26;
const MAX_BYTE_LENGTH = 42;

function appendBits(value, length, out) {
  if (!Number.isInteger(value) || value < 0 || value >>> length !== 0) {
    throw new RangeError('bit value out of range');
  }
  for (let i = length - 1; i >= 0; i -= 1) out.push((value >>> i) & 1);
}

function gfMultiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function reedSolomonDivisor(degree) {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < result.length; j += 1) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function reedSolomonRemainder(data, divisor) {
  const result = new Uint8Array(divisor.length);
  for (const byte of data) {
    const factor = byte ^ result[0];
    result.copyWithin(0, 1);
    result[result.length - 1] = 0;
    for (let i = 0; i < result.length; i += 1) {
      result[i] ^= gfMultiply(divisor[i], factor);
    }
  }
  return result;
}

function makeCodewords(text) {
  const bytes = new TextEncoder().encode(String(text));
  if (bytes.length > MAX_BYTE_LENGTH) throw new RangeError('QR payload is too long');

  const bits = [];
  appendBits(0x4, 4, bits); // Byte mode.
  appendBits(bytes.length, 8, bits);
  for (const byte of bytes) appendBits(byte, 8, bits);

  const capacityBits = DATA_CODEWORDS * 8;
  appendBits(0, Math.min(4, capacityBits - bits.length), bits);
  while (bits.length % 8 !== 0) bits.push(0);

  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j += 1) value = (value << 1) | bits[i + j];
    data.push(value);
  }
  for (let pad = 0; data.length < DATA_CODEWORDS; pad += 1) {
    data.push(pad % 2 === 0 ? 0xec : 0x11);
  }

  const ecc = reedSolomonRemainder(
    Uint8Array.from(data),
    reedSolomonDivisor(ECC_CODEWORDS)
  );
  return Uint8Array.from([...data, ...ecc]);
}

function getBit(value, index) {
  return ((value >>> index) & 1) !== 0;
}

function drawFormatBits(modules, functions, mask) {
  const errorCorrectionFormatBits = 0; // M.
  const data = (errorCorrectionFormatBits << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  }
  const bits = ((data << 10) | remainder) ^ 0x5412;
  const set = (x, y, dark) => {
    modules[y][x] = dark;
    functions[y][x] = true;
  };

  for (let i = 0; i <= 5; i += 1) set(8, i, getBit(bits, i));
  set(8, 7, getBit(bits, 6));
  set(8, 8, getBit(bits, 7));
  set(7, 8, getBit(bits, 8));
  for (let i = 9; i < 15; i += 1) set(14 - i, 8, getBit(bits, i));

  for (let i = 0; i < 8; i += 1) set(SIZE - 1 - i, 8, getBit(bits, i));
  for (let i = 8; i < 15; i += 1) set(8, SIZE - 15 + i, getBit(bits, i));
  set(8, SIZE - 8, true);
}

function drawFunctionPatterns(modules, functions) {
  const set = (x, y, dark) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    modules[y][x] = dark;
    functions[y][x] = true;
  };

  for (let i = 0; i < SIZE; i += 1) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }

  const drawFinder = (centerX, centerY) => {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        set(centerX + dx, centerY + dy, distance !== 2 && distance !== 4);
      }
    }
  };
  drawFinder(3, 3);
  drawFinder(SIZE - 4, 3);
  drawFinder(3, SIZE - 4);

  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      set(22 + dx, 22 + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  drawFormatBits(modules, functions, 0);
}

export function encodeQrMatrix(text) {
  const codewords = makeCodewords(text);
  const modules = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
  const functions = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
  drawFunctionPatterns(modules, functions);

  let bitIndex = 0;
  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let vertical = 0; vertical < SIZE; vertical += 1) {
      const y = upward ? SIZE - 1 - vertical : vertical;
      for (let offset = 0; offset < 2; offset += 1) {
        const x = right - offset;
        if (functions[y][x]) continue;
        let dark = false;
        if (bitIndex < codewords.length * 8) {
          dark = getBit(codewords[bitIndex >>> 3], 7 - (bitIndex & 7));
        }
        modules[y][x] = dark;
        bitIndex += 1;
      }
    }
  }

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if (!functions[y][x] && (x + y) % 2 === 0) modules[y][x] = !modules[y][x];
    }
  }
  drawFormatBits(modules, functions, 0);
  return modules;
}

export function isTronAddress(value) {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(String(value || '').trim());
}

export function renderTronAddressQrSvg(address) {
  const value = String(address || '').trim();
  if (!isTronAddress(value)) throw new TypeError('Invalid TRON address');

  const matrix = encodeQrMatrix(value);
  const border = 4;
  const size = matrix.length + border * 2;
  const cells = [];
  for (let y = 0; y < matrix.length; y += 1) {
    for (let x = 0; x < matrix.length; x += 1) {
      if (matrix[y][x]) cells.push(`M${x + border} ${y + border}h1v1h-1z`);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="USDT TRC20 payment address QR code"><rect width="100%" height="100%" fill="#fff"/><path d="${cells.join('')}" fill="#000"/></svg>`;
}

export const QR_VERSION = VERSION;
export const QR_SIZE = SIZE;
