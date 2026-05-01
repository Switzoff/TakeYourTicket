// Bootstrap Firebase Auth côté client.
// Définit window.authReady (Promise<User>) et window.apiFetch(url, opts).
// Si pas connecté, redirige vers /login.

firebase.initializeApp({
  apiKey: "AIzaSyAgel7LUkMikP4aXI1NFJPyHRJjHmRiEo4",
  authDomain: "takeyourticket-c82fc.firebaseapp.com",
  projectId: "takeyourticket-c82fc"
});

let resolveAuth;
window.authReady = new Promise(r => { resolveAuth = r; });

firebase.auth().onAuthStateChanged((user) => {
  if (!user) {
    const pending = localStorage.getItem('pendingTicket');
    localStorage.clear();
    if (pending) localStorage.setItem('pendingTicket', pending);
    if (location.pathname !== '/login') location.href = '/login';
    return;
  }
  localStorage.setItem('user', JSON.stringify({
    uid: user.uid,
    name: user.displayName,
    email: user.email,
    photo: user.photoURL,
  }));
  window.firebaseUser = user;
  resolveAuth(user);
});

window.apiFetch = async (url, opts = {}) => {
  const user = await window.authReady;
  const token = await user.getIdToken();
  const headers = { ...(opts.headers || {}), 'Authorization': `Bearer ${token}` };
  const res = await fetch(url, { ...opts, headers });
  if (res.status === 401) {
    localStorage.clear();
    location.href = '/login';
  }
  return res;
};
