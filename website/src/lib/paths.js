// Parse /p/<store>/<id> style paths.

/**
 * Product key from a /p/<store>/<id> path, normalised the same way
 * PTStores.identify() normalises ids. `url` is a working store link where one
 * can be built from the id alone (not for Flipkart, which needs the slug).
 */
export function identFromPath(store, rawId) {
  let id;
  try {
    id = decodeURIComponent(rawId);
  } catch (_) {
    return null;
  }
  if (store === 'amazon' && /^[A-Z0-9]{10}$/i.test(id)) {
    id = id.toUpperCase();
    return { store, id, key: `amazon:${id}`, url: `https://www.amazon.in/dp/${id}` };
  }
  if (store === 'flipkart') {
    if (/^itm[a-z0-9]+$/i.test(id)) id = id.toLowerCase();
    else if (/^[A-Z0-9]{6,32}$/i.test(id)) id = id.toUpperCase();
    else return null;
    return { store, id, key: `flipkart:${id}`, url: null };
  }
  if (store === 'myntra' && /^\d{5,12}$/.test(id)) return { store, id, key: `myntra:${id}`, url: `https://www.myntra.com/${id}` };
  return null;
}
