/**
 * Tiny DOM helpers. Elements are built with el(); user-typed text always goes
 * in as a text node, never as markup.
 */

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = String(v);
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'on' && typeof v === 'object') {
      for (const [evt, fn] of Object.entries(v)) node.addEventListener(evt, fn);
    } else if (k in node && k !== 'list' && typeof v !== 'object') node[k] = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) append(node, child);
    else if (child instanceof Node) node.append(child);
    else node.append(document.createTextNode(String(child)));
  }
}

export function qs(selector, root = document) {
  return root.querySelector(selector);
}

export function qsa(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function setChildren(node, children) {
  clear(node);
  append(node, children);
  return node;
}

export function fmt(value, digits = 0) {
  if (value == null || typeof value !== 'number' || !isFinite(value)) return '—';
  const s = value.toFixed(digits);
  return digits > 0 ? s.replace(/\.?0+$/, '') : s;
}

export function pctText(value, digits = 1) {
  return value == null || !isFinite(value) ? '—' : `${fmt(value, digits)}%`;
}
