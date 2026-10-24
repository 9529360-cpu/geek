//! Current-user Windows DPAPI only. No plaintext or machine-wide fallback.
//! ABI: Microsoft dpapi.h DATA_BLOB/CryptProtectData/CryptUnprotectData.
use crate::domain::error::{AppError, Result};
use std::{ffi::c_void, ptr};
use zeroize::{Zeroize, Zeroizing};

#[repr(C)]
struct DataBlob {
    len: u32,
    data: *mut u8,
}

#[link(name = "crypt32")]
extern "system" {
    fn CryptProtectData(
        input: *const DataBlob,
        description: *const u16,
        entropy: *const DataBlob,
        reserved: *mut c_void,
        prompt: *const c_void,
        flags: u32,
        output: *mut DataBlob,
    ) -> i32;
    fn CryptUnprotectData(
        input: *const DataBlob,
        description: *mut *mut u16,
        entropy: *const DataBlob,
        reserved: *mut c_void,
        prompt: *const c_void,
        flags: u32,
        output: *mut DataBlob,
    ) -> i32;
}
#[link(name = "kernel32")]
extern "system" {
    fn LocalFree(memory: *mut c_void) -> *mut c_void;
}

fn transform(bytes: &[u8], protect: bool) -> Result<Zeroizing<Vec<u8>>> {
    if bytes.is_empty() || bytes.len() > 2 * 1024 * 1024 {
        return Err(AppError::StoreInvalid);
    }
    let input = DataBlob {
        len: bytes.len() as u32,
        data: bytes.as_ptr() as *mut u8,
    };
    let mut output = DataBlob {
        len: 0,
        data: ptr::null_mut(),
    };
    // SAFETY: input is alive for the synchronous call; optional pointers are null.
    // Windows allocates output with LocalAlloc. CRYPTPROTECT_UI_FORBIDDEN = 1;
    // CRYPTPROTECT_LOCAL_MACHINE is deliberately not set.
    let success = unsafe {
        if protect {
            CryptProtectData(
                &input,
                ptr::null(),
                ptr::null(),
                ptr::null_mut(),
                ptr::null(),
                1,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                ptr::null_mut(),
                ptr::null(),
                ptr::null_mut(),
                ptr::null(),
                1,
                &mut output,
            )
        }
    };
    if success == 0 || output.data.is_null() {
        return Err(AppError::DpapiFailed);
    }
    // SAFETY: successful DPAPI output owns exactly output.len bytes until LocalFree.
    let result = unsafe {
        let buffer = std::slice::from_raw_parts_mut(output.data, output.len as usize);
        let copied = Zeroizing::new(buffer.to_vec());
        buffer.zeroize();
        LocalFree(output.data.cast());
        copied
    };
    Ok(result)
}

pub fn encrypt(bytes: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
    transform(bytes, true)
}
pub fn decrypt(bytes: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
    transform(bytes, false)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roundtrip_and_tamper() {
        let plain = b"synthetic-account-metadata";
        let mut encrypted = encrypt(plain).unwrap();
        assert_ne!(&encrypted[..], plain);
        assert_eq!(&decrypt(&encrypted).unwrap()[..], plain);
        encrypted[0] ^= 0xff;
        assert!(decrypt(&encrypted).is_err());
        assert!(decrypt(b"not-a-dpapi-blob").is_err());
    }
}
