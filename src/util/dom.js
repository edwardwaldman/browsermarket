// Tiny DOM helpers - no framework, no build step.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k.startsWith('data')) node.setAttribute(k.replace(/([A-Z])/g, '-$1').toLowerCase(), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Replace a node's children only when the rendered markup actually changed. */
export function patch(node, html) {
  if (node.__lastHtml === html) return false;
  node.__lastHtml = html;
  node.innerHTML = html;
  return true;
}

export function cls(...parts) {
  return parts.filter(Boolean).join(' ');
}

export function on(root, event, selector, handler) {
  root.addEventListener(event, (e) => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) handler(e, target);
  });
}

/**
 * The effective CSS zoom a node is rendered inside.
 *
 * `zoom` does not show up in a descendant's computed style, so asking the node
 * itself always answers 1: it has to be multiplied up the ancestor chain. Any
 * code that measures with getBoundingClientRect, which reports screen pixels,
 * and then writes the number back as a layout value needs this or it will be
 * out by the zoom. That is how the dock came to grow three quarters as fast as
 * the hand dragging it.
 */
export function zoomOf(node) {
  let z = 1;
  for (let n = node; n instanceof Element; n = n.parentElement) {
    const v = parseFloat(getComputedStyle(n).zoom);
    if (Number.isFinite(v) && v > 0) z *= v;
  }
  return z;
}
