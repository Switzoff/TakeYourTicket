const admin = require('firebase-admin');

const serviceAccount = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
  ? JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
  : require('./serviceAccount.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function verifierToken(req) {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const TMDB_API_KEY = '6ab36cec6d539dc145a762e4d15524f3';
const PORT = 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));

app.post('/api/generer-tickets', async (req, res) => {
  const { film, cinema, date, quantite, holo } = req.body;
  const ticketsGeneres = [];
  for (let i = 0; i < quantite; i++) {
    const id = uuidv4();
    await db.collection('tickets').doc(id).set({
      id, film, cinema, date, scanne: false, proprietaire: null, holo: holo || false
    });
    ticketsGeneres.push(id);
  }
  res.json({ succes: true, tickets: ticketsGeneres });
});

app.get('/scan/:id', async (req, res) => {
  const { id } = req.params;
  const uid = req.query.uid;
  const doc = await db.collection('tickets').doc(id).get();
  if (!doc.exists) return res.send('<h1>Ticket invalide</h1>');
  const ticket = doc.data();
  if (ticket.scanne) return res.send('<h1>Ce ticket a déjà été scanné</h1>');
  await db.collection('tickets').doc(id).update({ scanne: true });
  if (uid) {
    await db.collection('collections').add({
      uid,
      film: ticket.film,
      cinema: ticket.cinema,
      date: ticket.date,
      ticketId: id,
      holo: ticket.holo || false,
      createdAt: new Date()
    });
  }
  res.redirect(`/scan-animation?film=${encodeURIComponent(ticket.film)}&holo=${ticket.holo || false}`);
});

app.get('/api/tickets', async (req, res) => {
  const snapshot = await db.collection('tickets').get();
  const tickets = snapshot.docs.map(doc => doc.data());
  res.json(tickets);
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
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/api/collections', async (req, res) => {
  const { uid } = req.query;
  if (!uid) return res.json([]);
  const snapshot = await db.collection('collections').where('uid', '==', uid).get();
  const tickets = snapshot.docs.map(doc => doc.data());
  res.json(tickets);
});

app.get('/api/profile', async (req, res) => {
  const { uid } = req.query;
  if (!uid) return res.status(400).json({ error: 'uid requis' });
  const doc = await db.collection('profiles').doc(uid).get();
  if (!doc.exists) return res.json({});
  res.json(doc.data());
});

app.post('/api/profile', async (req, res) => {
  const { uid, displayName, photoURL, favoriteFilms, favoriteActors } = req.body;
  if (!uid) return res.status(400).json({ error: 'uid requis' });
  const data = { updatedAt: new Date() };
  if (displayName !== undefined) data.displayName = displayName;
  if (photoURL !== undefined) data.photoURL = photoURL;
  if (Array.isArray(favoriteFilms)) data.favoriteFilms = favoriteFilms;
  if (Array.isArray(favoriteActors)) data.favoriteActors = favoriteActors;
  await db.collection('profiles').doc(uid).set(data, { merge: true });
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

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/scan-animation', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'scan-animation.html'));
});

app.listen(PORT, () => {
  console.log(`TakeYourTicket tourne sur http://localhost:${PORT}`);
});