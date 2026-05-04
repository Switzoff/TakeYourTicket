const admin = require('firebase-admin');

const serviceAccount = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
  ? JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
  : require('./serviceAccount.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const ADMIN_UIDS = (process.env.ADMIN_UIDS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) return res.status(401).json({ error: 'Token manquant' });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.uid = decoded.uid;
    req.token = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Token invalide' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!ADMIN_UIDS.includes(req.uid)) {
      return res.status(403).json({ error: 'Accès admin requis' });
    }
    next();
  });
}

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { findBadgeForFilm } = require('./badges');

const app = express();
const TMDB_API_KEY = '6ab36cec6d539dc145a762e4d15524f3';
const PORT = 3000;

app.use(express.json({ limit: '4mb' }));
app.use(express.static('public'));

app.post('/api/generer-tickets', requireAdmin, async (req, res) => {
  const { film, cinema, date, holo, recto, verso } = req.body;
  const quantite = parseInt(req.body.quantite, 10);
  if (!film || !cinema || !date) {
    return res.status(400).json({ error: 'film, cinema, date requis' });
  }
  if (!Number.isInteger(quantite) || quantite < 1 || quantite > 500) {
    return res.status(400).json({ error: 'quantite doit être entre 1 et 500' });
  }
  if (String(film).length > 200 || String(cinema).length > 200) {
    return res.status(400).json({ error: 'film/cinema trop long' });
  }
  for (const [name, val] of [['recto', recto], ['verso', verso]]) {
    if (val && (typeof val !== 'string' || val.length > 800000 || !val.startsWith('data:image/'))) {
      return res.status(400).json({ error: name + ' invalide' });
    }
  }

  // Si recto/verso fournis, on les stocke dans des sous-documents séparés
  // (Firestore limite à 1 Mo par document, donc on évite de tout mettre dans
  // un seul doc batches/{batchId} qui pourrait dépasser la limite).
  let batchId = null;
  if (recto || verso) {
    batchId = uuidv4();
    const batchRef = db.collection('batches').doc(batchId);
    const writes = [batchRef.set({ film, createdAt: new Date() })];
    if (recto) writes.push(batchRef.collection('assets').doc('recto').set({ data: recto }));
    if (verso) writes.push(batchRef.collection('assets').doc('verso').set({ data: verso }));
    await Promise.all(writes);
  }

  const ticketsGeneres = [];
  for (let i = 0; i < quantite; i++) {
    const id = uuidv4();
    const data = { id, film, cinema, date, scanne: false, proprietaire: null, holo: !!holo };
    if (batchId) data.batchId = batchId;
    await db.collection('tickets').doc(id).set(data);
    ticketsGeneres.push(id);
  }
  res.json({ succes: true, tickets: ticketsGeneres });
});

// Le QR du ticket pointe ici. On redirige vers la page client qui se chargera
// d'appeler /api/scan/:id avec un token authentifié.
app.get('/scan/:id', (req, res) => {
  res.redirect(`/scan-page/${req.params.id}`);
});

// Scan authentifié : marque le ticket scanné et l'ajoute à la collection de l'utilisateur connecté.
app.post('/api/scan/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const ref = db.collection('tickets').doc(id);
  const doc = await ref.get();
  if (!doc.exists) return res.status(404).json({ error: 'Ticket invalide' });
  const ticket = doc.data();
  if (ticket.scanne) return res.status(409).json({ error: 'Ticket déjà scanné' });
  await ref.update({ scanne: true, proprietaire: req.uid });

  // Récupère recto/verso depuis les sous-documents du batch
  let recto = null, verso = null;
  if (ticket.batchId) {
    const assetsRef = db.collection('batches').doc(ticket.batchId).collection('assets');
    const [rectoDoc, versoDoc] = await Promise.all([
      assetsRef.doc('recto').get(),
      assetsRef.doc('verso').get(),
    ]);
    if (rectoDoc.exists) recto = rectoDoc.data().data || null;
    if (versoDoc.exists) verso = versoDoc.data().data || null;
  }

  // On stocke seulement batchId dans collections (pas les images inline)
  // car Firestore plafonne chaque doc à 1 Mo. Le client ira chercher
  // les assets via /api/batch-assets/:batchId quand il en a besoin.
  await db.collection('collections').add({
    uid: req.uid,
    film: ticket.film,
    cinema: ticket.cinema,
    date: ticket.date,
    ticketId: id,
    holo: ticket.holo || false,
    ...(ticket.batchId ? { batchId: ticket.batchId } : {}),
    createdAt: new Date()
  });

  // Attribution automatique d'un badge selon le film, en évitant les doublons
  let unlockedBadge = null;
  const badge = findBadgeForFilm(ticket.film);
  if (badge) {
    const profileRef = db.collection('profiles').doc(req.uid);
    const profileDoc = await profileRef.get();
    const existing = profileDoc.exists ? (profileDoc.data().badges || []) : [];
    if (!existing.some(b => b.id === badge.id)) {
      const newBadge = {
        id: badge.id,
        name: badge.name,
        icon: badge.icon,
        color: badge.color || '#2a2a2a',
        accent: badge.accent || '#d4a017',
        description: badge.description,
        ticketId: id,
        filmTitle: ticket.film,
        unlockedAt: new Date().toISOString(),
      };
      await profileRef.set({
        badges: admin.firestore.FieldValue.arrayUnion(newBadge),
      }, { merge: true });
      unlockedBadge = newBadge;
    }
  }

  res.json({ success: true, film: ticket.film, holo: !!ticket.holo, badge: unlockedBadge });
});

app.get('/collection', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/affiche/:film', async (req, res) => {
  const film = req.params.film;
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(film)}&language=fr-FR`;
  const response = await fetch(url);
  const data = await response.json();
  if (data.results && data.results[0] && data.results[0].poster_path) {
    res.json({ affiche: `https://image.tmdb.org/t/p/original${data.results[0].poster_path}` });
  } else {
    res.json({ affiche: null });
  }
});

app.get('/api/recherche-films', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(q)}&language=fr-FR&page=1`;
  try {
    const response = await fetch(url);
    const data = await response.json();
    const results = (data.results || []).slice(0, 12).map(r => ({
      id: r.id,
      title: r.title,
      year: r.release_date ? String(r.release_date).slice(0, 4) : '',
      poster: r.poster_path ? `https://image.tmdb.org/t/p/w185${r.poster_path}` : null,
    }));
    res.json(results);
  } catch (e) {
    res.json([]);
  }
});

// Fiche détaillée d'un film (synopsis + casting + backdrop) pour la page Collection
app.get('/api/film-details', async (req, res) => {
  const title = (req.query.title || '').trim();
  if (!title) return res.status(400).json({ error: 'title requis' });
  try {
    const searchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=fr-FR`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();
    const movie = (searchData.results || [])[0];
    if (!movie) return res.json({});

    const [detailsRes, creditsRes] = await Promise.all([
      fetch(`https://api.themoviedb.org/3/movie/${movie.id}?api_key=${TMDB_API_KEY}&language=fr-FR`),
      fetch(`https://api.themoviedb.org/3/movie/${movie.id}/credits?api_key=${TMDB_API_KEY}&language=fr-FR`),
    ]);
    const details = await detailsRes.json();
    const credits = await creditsRes.json();

    res.json({
      id: details.id,
      title: details.title || '',
      tagline: details.tagline || '',
      overview: details.overview || '',
      releaseDate: details.release_date || '',
      runtime: details.runtime || null,
      genres: (details.genres || []).map(g => g.name),
      poster: details.poster_path ? `https://image.tmdb.org/t/p/w500${details.poster_path}` : null,
      backdrop: details.backdrop_path ? `https://image.tmdb.org/t/p/original${details.backdrop_path}` : null,
      cast: (credits.cast || []).slice(0, 8).map(c => ({
        name: c.name,
        character: c.character,
        photo: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : null,
      })),
    });
  } catch (e) {
    res.json({});
  }
});

// Proxy d'images TMDB pour contourner le CORS lors du téléchargement (html2canvas)
app.get('/api/proxy-image', async (req, res) => {
  const url = String(req.query.url || '');
  if (!url.startsWith('https://image.tmdb.org/')) {
    return res.status(400).json({ error: 'URL non autorisée' });
  }
  try {
    const r = await fetch(url);
    if (!r.ok) return res.status(r.status).end();
    res.set('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=86400');
    const buffer = await r.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (e) {
    res.status(500).end();
  }
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/api/collections', requireAuth, async (req, res) => {
  const snapshot = await db.collection('collections').where('uid', '==', req.uid).get();
  const tickets = snapshot.docs.map(doc => doc.data());
  res.json(tickets);
});

// Récupère les visuels recto/verso d'un batch (utilisé pour afficher la carte 3D)
app.get('/api/batch-assets/:batchId', requireAuth, async (req, res) => {
  const { batchId } = req.params;
  if (!batchId) return res.status(400).json({ error: 'batchId requis' });
  const assetsRef = db.collection('batches').doc(batchId).collection('assets');
  const [rectoDoc, versoDoc] = await Promise.all([
    assetsRef.doc('recto').get(),
    assetsRef.doc('verso').get(),
  ]);
  res.json({
    recto: rectoDoc.exists ? rectoDoc.data().data : null,
    verso: versoDoc.exists ? versoDoc.data().data : null,
  });
});

app.get('/api/profile', requireAuth, async (req, res) => {
  const doc = await db.collection('profiles').doc(req.uid).get();
  if (!doc.exists) return res.json({});
  res.json(doc.data());
});

app.post('/api/profile', requireAuth, async (req, res) => {
  const { displayName, photoURL, favoriteFilms, favoriteActors, favoriteQuotes } = req.body;
  const data = { updatedAt: new Date() };
  if (displayName !== undefined) {
    if (typeof displayName !== 'string' || displayName.length > 60) {
      return res.status(400).json({ error: 'displayName invalide' });
    }
    data.displayName = displayName;
    data.displayNameLower = displayName.toLowerCase();
  }
  if (photoURL !== undefined) {
    if (typeof photoURL !== 'string' || photoURL.length > 500000) {
      return res.status(400).json({ error: 'photoURL invalide' });
    }
    data.photoURL = photoURL;
  }
  if (Array.isArray(favoriteFilms)) {
    if (favoriteFilms.length > 50) return res.status(400).json({ error: 'trop de films' });
    data.favoriteFilms = favoriteFilms;
  }
  if (Array.isArray(favoriteActors)) {
    if (favoriteActors.length > 50) return res.status(400).json({ error: 'trop d\'acteurs' });
    data.favoriteActors = favoriteActors;
  }
  if (Array.isArray(favoriteQuotes)) {
    if (favoriteQuotes.length > 50) return res.status(400).json({ error: 'trop de répliques' });
    data.favoriteQuotes = favoriteQuotes;
  }
  await db.collection('profiles').doc(req.uid).set(data, { merge: true });
  res.json({ success: true });
});

// Profil public (sans email ni liste d'amis) — pour visualisation par d'autres
// Respecte la confidentialité : profil "friends" n'est visible que par les amis
app.get('/api/profile-public', async (req, res) => {
  const { uid } = req.query;
  if (!uid) return res.status(400).json({ error: 'uid requis' });
  const doc = await db.collection('profiles').doc(uid).get();
  if (!doc.exists) return res.json({});
  const d = doc.data();

  // Si profil privé (visibility=friends), seuls les amis peuvent le voir
  if (d.visibility === 'friends') {
    const token = req.headers.authorization?.split('Bearer ')[1];
    let viewerUid = null;
    if (token) {
      try { viewerUid = (await admin.auth().verifyIdToken(token)).uid; } catch {}
    }
    const isFriend = viewerUid && (d.friends || []).includes(viewerUid);
    const isSelf = viewerUid === uid;
    if (!isFriend && !isSelf) {
      return res.json({
        uid, private: true,
        displayName: d.displayName || '',
        photoURL: d.photoURL || '',
      });
    }
  }

  res.json({
    uid,
    displayName: d.displayName || '',
    photoURL: d.photoURL || '',
    favoriteFilms: d.favoriteFilms || [],
    favoriteActors: d.favoriteActors || [],
    favoriteQuotes: d.favoriteQuotes || [],
    badges: d.badges || [],
    friendRequests: d.friendRequests || 'everyone',
  });
});

// Recherche d'utilisateurs par nom
// Filtre les utilisateurs bloqués (dans les deux sens) et les comptes ayant
// désactivé les demandes d'ami quand un utilisateur connecté cherche.
app.get('/api/recherche-utilisateurs', async (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (q.length < 2) return res.json([]);

  let viewerUid = null;
  let viewerBlocked = [];
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (token) {
    try {
      viewerUid = (await admin.auth().verifyIdToken(token)).uid;
      const v = await db.collection('profiles').doc(viewerUid).get();
      viewerBlocked = v.exists ? (v.data().blockedUsers || []) : [];
    } catch {}
  }

  const snap = await db.collection('profiles').get();
  const results = snap.docs
    .map(doc => ({ uid: doc.id, ...doc.data() }))
    .filter(p => p.uid !== viewerUid)
    .filter(p => (p.displayName || '').toLowerCase().includes(q))
    .filter(p => !viewerBlocked.includes(p.uid))
    .filter(p => !(p.blockedUsers || []).includes(viewerUid))
    .slice(0, 12)
    .map(p => ({
      uid: p.uid,
      displayName: p.displayName || '',
      photoURL: p.photoURL || '',
    }));
  res.json(results);
});

// Liste des amis
app.get('/api/amis', requireAuth, async (req, res) => {
  const doc = await db.collection('profiles').doc(req.uid).get();
  const friendUids = doc.exists ? (doc.data().friends || []) : [];
  if (!friendUids.length) return res.json([]);
  const friends = await Promise.all(friendUids.map(async (fid) => {
    const fdoc = await db.collection('profiles').doc(fid).get();
    if (!fdoc.exists) return null;
    const f = fdoc.data();
    return {
      uid: fid,
      displayName: f.displayName || '',
      photoURL: f.photoURL || '',
    };
  }));
  res.json(friends.filter(Boolean));
});

// Ajouter un ami
app.post('/api/amis', requireAuth, async (req, res) => {
  const { friendUid } = req.body;
  if (!friendUid) return res.status(400).json({ error: 'friendUid requis' });
  if (req.uid === friendUid) return res.status(400).json({ error: 'Pas toi-même' });

  // Refuse si la cible n'accepte pas les demandes ou bloque l'utilisateur
  const target = await db.collection('profiles').doc(friendUid).get();
  if (target.exists) {
    const t = target.data();
    if (t.friendRequests === 'nobody') {
      return res.status(403).json({ error: 'Cet utilisateur n\'accepte pas les demandes' });
    }
    if ((t.blockedUsers || []).includes(req.uid)) {
      return res.status(403).json({ error: 'Ajout impossible' });
    }
  }

  await db.collection('profiles').doc(req.uid).set({
    friends: admin.firestore.FieldValue.arrayUnion(friendUid),
  }, { merge: true });
  res.json({ success: true });
});

// Retirer un ami
app.delete('/api/amis', requireAuth, async (req, res) => {
  const { friendUid } = req.query;
  if (!friendUid) return res.status(400).json({ error: 'friendUid requis' });
  await db.collection('profiles').doc(req.uid).set({
    friends: admin.firestore.FieldValue.arrayRemove(friendUid),
  }, { merge: true });
  res.json({ success: true });
});

app.get('/scan-page/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'scan.html'));
});

app.get('/scanner', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'scanner.html'));
});

app.get('/profil', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'profil.html'));
});

app.get('/u/:uid', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'public-profile.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/badges', (req, res) => {
  const { BADGES } = require('./badges');
  res.json(BADGES.map(({ id, name, icon, color, accent, description }) => ({ id, name, icon, color, accent, description })));
});

app.get('/scan-animation', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'scan-animation.html'));
});

app.get('/reglages', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reglages.html'));
});

app.get(['/cgu', '/confidentialite'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'legal.html'));
});

// ── Réglages : confidentialité ─────────────────────────────────────────
// visibility: 'public' | 'friends'
// friendRequests: 'everyone' | 'nobody'
app.patch('/api/profile/privacy', requireAuth, async (req, res) => {
  const { visibility, friendRequests } = req.body;
  const data = {};
  if (visibility !== undefined) {
    if (!['public', 'friends'].includes(visibility)) {
      return res.status(400).json({ error: 'visibility invalide' });
    }
    data.visibility = visibility;
  }
  if (friendRequests !== undefined) {
    if (!['everyone', 'nobody'].includes(friendRequests)) {
      return res.status(400).json({ error: 'friendRequests invalide' });
    }
    data.friendRequests = friendRequests;
  }
  if (!Object.keys(data).length) return res.status(400).json({ error: 'rien à mettre à jour' });
  await db.collection('profiles').doc(req.uid).set(data, { merge: true });
  res.json({ success: true });
});

// ── Bloquer / débloquer un utilisateur ─────────────────────────────────
app.get('/api/blocks', requireAuth, async (req, res) => {
  const doc = await db.collection('profiles').doc(req.uid).get();
  const blockedUids = doc.exists ? (doc.data().blockedUsers || []) : [];
  if (!blockedUids.length) return res.json([]);
  const blocked = await Promise.all(blockedUids.map(async (bid) => {
    const bdoc = await db.collection('profiles').doc(bid).get();
    if (!bdoc.exists) return { uid: bid, displayName: '(compte supprimé)', photoURL: '' };
    const b = bdoc.data();
    return { uid: bid, displayName: b.displayName || '', photoURL: b.photoURL || '' };
  }));
  res.json(blocked);
});

app.post('/api/blocks', requireAuth, async (req, res) => {
  const { uid } = req.body;
  if (!uid) return res.status(400).json({ error: 'uid requis' });
  if (uid === req.uid) return res.status(400).json({ error: 'Pas toi-même' });
  await db.collection('profiles').doc(req.uid).set({
    blockedUsers: admin.firestore.FieldValue.arrayUnion(uid),
    friends: admin.firestore.FieldValue.arrayRemove(uid),
  }, { merge: true });
  res.json({ success: true });
});

app.delete('/api/blocks/:uid', requireAuth, async (req, res) => {
  await db.collection('profiles').doc(req.uid).set({
    blockedUsers: admin.firestore.FieldValue.arrayRemove(req.params.uid),
  }, { merge: true });
  res.json({ success: true });
});

// ── Export RGPD : toutes les données de l'utilisateur ──────────────────
app.get('/api/export-data', requireAuth, async (req, res) => {
  const [profileDoc, collectionsSnap] = await Promise.all([
    db.collection('profiles').doc(req.uid).get(),
    db.collection('collections').where('uid', '==', req.uid).get(),
  ]);
  const profile = profileDoc.exists ? profileDoc.data() : {};
  const collections = collectionsSnap.docs.map(d => d.data());
  res.json({
    exportedAt: new Date().toISOString(),
    uid: req.uid,
    email: req.token.email || null,
    profile,
    collections,
  });
});

// ── Suppression du compte (Firestore + Firebase Auth) ──────────────────
app.delete('/api/account', requireAuth, async (req, res) => {
  try {
    // 1. Supprimer les tickets de la collection
    const colSnap = await db.collection('collections').where('uid', '==', req.uid).get();
    const batch = db.batch();
    colSnap.docs.forEach(d => batch.delete(d.ref));
    // 2. Supprimer le profil
    batch.delete(db.collection('profiles').doc(req.uid));
    await batch.commit();
    // 3. Supprimer l'utilisateur Firebase Auth (sinon il pourrait re-créer un profil avec le même UID)
    await admin.auth().deleteUser(req.uid);
    res.json({ success: true });
  } catch (e) {
    console.error('[delete account]', e);
    res.status(500).json({ error: 'Suppression échouée' });
  }
});

app.listen(PORT, () => {
  console.log(`TakeYourTicket tourne sur http://localhost:${PORT}`);
});
