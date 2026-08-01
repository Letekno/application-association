const express = require('express');
const bcrypt = require('bcryptjs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./association.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS utilisateurs (id INTEGER PRIMARY KEY AUTOINCREMENT, identifiant TEXT UNIQUE, mot_de_passe TEXT, role TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS grandes_familles (id INTEGER PRIMARY KEY AUTOINCREMENT, nom TEXT UNIQUE)`);
    db.run(`CREATE TABLE IF NOT EXISTS projets (id INTEGER PRIMARY KEY AUTOINCREMENT, nom TEXT UNIQUE)`);
    db.run(`CREATE TABLE IF NOT EXISTS membres (id INTEGER PRIMARY KEY AUTOINCREMENT, matricule TEXT UNIQUE, nom TEXT, prenom TEXT, ville TEXT, telephone TEXT, email TEXT, grande_famille_id INTEGER, frais_adhesion REAL, date_adhesion TEXT, famille_proches TEXT, est_decede INTEGER DEFAULT 0)`);
    db.run(`CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, membre_id INTEGER, type_flux TEXT, type_cotisation TEXT, projet_id INTEGER, montant REAL, date_transaction TEXT, mode_paiement TEXT, motif TEXT)`);

    db.run(`INSERT OR IGNORE INTO utilisateurs (identifiant, mot_de_passe, role) VALUES ('admin', '${bcrypt.hashSync("admin123", 10)}', 'SUPER_ADMIN')`);
    db.run(`INSERT OR IGNORE INTO grandes_familles (nom) VALUES ('Famille Traoré'), ('Famille Kouadio'), ('Famille Diallo')`);
    db.run(`INSERT OR IGNORE INTO projets (nom) VALUES ('Achat Terrain Siège'), ('Arbre de Noël')`);
});

app.post('/api/membres/inscription', (req, res) => {
    const { nom, prenom, ville, telephone, grande_famille_id, frais_adhesion, famille_proches } = req.body;
    const date = new Date().toISOString().split('T')[0];
    db.get(`SELECT COUNT(*) AS total FROM membres`, (err, row) => {
        const matricule = `ASSOC-2026-${String((row ? row.total : 0) + 1).padStart(4, '0')}`;
        db.run(`INSERT INTO membres (matricule, nom, prenom, ville, telephone, grande_famille_id, frais_adhesion, date_adhesion, famille_proches) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [matricule, nom, prenom, ville, telephone, grande_famille_id, frais_adhesion, date, JSON.stringify(famille_proches)], function() {
                db.run(`INSERT INTO transactions (membre_id, type_flux, type_cotisation, montant, date_transaction, mode_paiement, motif) VALUES (?, 'ENCAISSEMENT', 'ADHESION', ?, ?, 'ESPECES', 'Frais initial')`, [this.lastID, frais_adhesion, date]);
                res.json({ success: true, message: `Inscrit ! Matricule : ${matricule}`, matricule: matricule });
            });
    });
});

app.post('/api/membres/deces/:id', (req, res) => {
    const mId = req.params.id;
    const date = new Date().toISOString().split('T')[0];
    db.get(`SELECT SUM(montant) AS total FROM transactions WHERE membre_id = ? AND type_flux = 'ENCAISSEMENT'`, [mId], (err, row) => {
        const totalACloturer = row ? (row.total || 0) : 0;
        db.serialize(() => {
            db.run(`UPDATE membres SET est_decede = 1 WHERE id = ?`, [mId]);
            db.run(`INSERT INTO transactions (membre_id, type_flux, type_cotisation, montant, date_transaction, mode_paiement, motif) VALUES (?, 'DECAISSEMENT', 'TRANSFERT_FAMILLE', ?, ?, 'ESPECES', 'Clôture de compte')`, [mId, totalACloturer, date]);
            res.json({ success: true, message: `Décès validé. Compte soldé de ${totalACloturer} FCFA.` });
        });
    });
});

app.post('/api/paiement/cotisation', (req, res) => {
    const { membre_id, type_cotisation, projet_id, montant, mode_paiement } = req.body;
    const date = new Date().toISOString().split('T')[0];
    db.run(`INSERT INTO transactions (membre_id, type_flux, type_cotisation, projet_id, montant, date_transaction, mode_paiement, motif) VALUES (?, 'ENCAISSEMENT', ?, ?, ?, ?, ?, 'Cotisation validée')`,
        [membre_id, type_cotisation, projet_id || null, montant, date, mode_paiement], () => {
            res.json({ success: true, message: `Paiement ${mode_paiement} enregistré !` });
        });
});

app.post('/api/comptabilite/decaissement', (req, res) => {
    const { montant, motif, mode_paiement } = req.body;
    const date = new Date().toISOString().split('T')[0];
    db.run(`INSERT INTO transactions (type_flux, montant, date_transaction, mode_paiement, motif) VALUES ('DECAISSEMENT', ?, ?, ?, ?)`, [montant, date, mode_paiement, motif], () => {
        res.json({ success: true, message: "Sortie enregistrée." });
    });
});

app.get('/api/comptabilite/solde', (req, res) => {
    db.get(`SELECT SUM(CASE WHEN type_flux = 'ENCAISSEMENT' THEN montant ELSE 0 END) - SUM(CASE WHEN type_flux = 'DECAISSEMENT' THEN montant ELSE 0 END) AS solde FROM transactions`, (err, row) => {
        res.json({ solde_temps_reel: row ? (row.solde || 0) : 0 });
    });
});

app.get('/api/membres/recherche', (req, res) => {
    db.get(`SELECT m.*, gf.nom AS nom_famille, t.date_transaction, t.type_cotisation, t.montant, t.mode_paiement 
            FROM membres m LEFT JOIN grandes_familles gf ON m.grande_famille_id = gf.id LEFT JOIN transactions t ON t.membre_id = m.id AND t.type_flux = 'ENCAISSEMENT'
            WHERE m.matricule = ? OR m.nom LIKE ? ORDER BY t.id DESC LIMIT 1`, [req.query.cle, `%${req.query.cle}%`], (err, row) => {
        res.json(row);
    });
});

// ENVOI DE L'INTERFACE GRAPHIQUE COMPLÈTE DEPUIS LE FICHIER SÉPARÉ
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => console.log(`Serveur actif sur http://localhost:${PORT}`));
