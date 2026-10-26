const DRAG_TYPE = 'application/x-geek-account-order';

// A local drag session authorizes the UI gesture; Rust still validates both owners.
// External text/files and detached rows cannot become account mutations.
export function createAccountOrder(list) {
  let dragged = null;
  let epoch = 0;
  let suppressClick = false;
  function clearMarkers() {
    for (const row of list.children) row.classList.remove('dragging', 'drop-target');
  }
  function reset() {
    clearMarkers();
    dragged = null;
    epoch += 1;
  }
  function allowClick(event) {
    if (suppressClick && event.detail !== 0) {
      suppressClick = false;
      event.preventDefault();
      return false;
    }
    return !dragged;
  }
  function bind(row, id, visibleIds, move) {
    const boundEpoch = epoch;
    row.draggable = true;
    const eligible = () => !row.disabled && row.parentElement === list && boundEpoch === epoch;
    const target = () => eligible() && dragged && dragged.epoch === epoch
      && dragged.row.parentElement === list && visibleIds.has(dragged.id) && dragged.id !== id;
    row.addEventListener('pointerdown', () => { if (!dragged) suppressClick = false; });
    row.addEventListener('dragstart', (event) => {
      if (!eligible() || !event.dataTransfer) { event.preventDefault(); return; }
      clearMarkers();
      dragged = { id, row, epoch };
      suppressClick = true;
      event.dataTransfer.setData(DRAG_TYPE, id);
      event.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    row.addEventListener('dragover', (event) => {
      event.preventDefault();
      const accepted = target() && Array.from(event.dataTransfer?.types || []).includes(DRAG_TYPE);
      if (event.dataTransfer) event.dataTransfer.dropEffect = accepted ? 'move' : 'none';
      for (const item of list.children) item.classList.remove('drop-target');
      if (accepted) row.classList.add('drop-target');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
    row.addEventListener('drop', (event) => {
      event.preventDefault();
      const fromId = target() && event.dataTransfer?.getData(DRAG_TYPE) === dragged.id ? dragged.id : null;
      clearMarkers();
      dragged = null;
      if (fromId) move(fromId, id);
    });
    row.addEventListener('dragend', () => {
      // A prior render may already have replaced this session's rows.
      if (boundEpoch === epoch) { clearMarkers(); dragged = null; }
    });
  }
  return { reset, bind, allowClick };
}
