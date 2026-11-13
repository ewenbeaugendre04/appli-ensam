"use strict";
// Section Réviser : cartes à répétition espacée, fiches, équations, définitions, textes à trous,
// calculs, principes à expliquer (Feynman), résumés à faire valider, QCM, vidage de mémoire.
// Chargé avant app.js : les fonctions ne s'exécutent qu'après le démarrage de l'app.

const R = {
	chap: {}, // id → chapitre
	session: null, // { titre, cles:[], i, repondu }
	ouvert: null, // id du chapitre affiché
	partiel: null, // id du partiel affiché
	brouillons: null,
	chrono: null,
};
const BOITES = [0, 1, 3, 7, 16, 35]; // jours avant la prochaine révision, par boîte (méthode Leitner)
const TYPES = {
	flash: "Carte", definition: "Définition", equation: "Équation", fiche: "Fiche mémo", trous: "Texte à trous",
	calcul: "Calcul", principe: "Principe à expliquer", resume: "Résumé à faire", qcm: "QCM", memoire: "Vidage de mémoire",
};
const RECALL = ["flash", "definition", "equation"];
const EXOS = ["qcm", "trous", "calcul", "principe"];

// ---------- Données ----------
async function chargerRevision() {
	const idx = await lire("revision/index.json", { chapitres: [] });
	const progres = await lire("revision/progres.json", {});
	const rendus = await lire("revision/rendus.json", []);
	const signalements = await lire("revision/signalements.json", []).catch(() => []);
	const lexique = await lire("revision/lexique.json", { termes: [] }).catch(() => ({ termes: [] }));
	store.set("ae.lexique", lexique); LEX = null;
	const chs = await Promise.all((idx.chapitres || []).map((c) => lire(`revision/chapitres/${c.id}.json`, null).catch(() => null)));
	S.data.revision = { index: idx, rendus, signalements };
	S.data.progres = fusionProgres(progres, store.get("ae.progres.local", {}));
	R.chap = {};
	chs.forEach((c) => { if (c) R.chap[c.id] = c; });
	appliquerMasques();
	store.set("ae.chap", R.chap);
	DICO = null;
}
function initRevisionCache() {
	if (!S.data.revision) S.data.revision = { index: { chapitres: [] }, rendus: [] };
	if (!S.data.progres) S.data.progres = {};
	R.chap = store.get("ae.chap", {});
	appliquerMasques();
	R.brouillons = store.get("ae.brouillons", {});
}
// Éléments retirés : masqués par la tâche de nuit, ou signalés « inutile » (en attente de traitement)
function appliquerMasques() {
	const inutiles = new Set((S.data.revision?.signalements || []).filter((x) => x.raison === "inutile" && x.statut !== "garde").map((x) => x.cle));
	for (const ch of Object.values(R.chap)) ch.items = (ch.items || []).filter((it) => !it.masque && !inutiles.has(cle(ch.id, it.id)));
}

// ---------- Signaler une question ----------
const RAISONS = [["inutile", "Question inutile", "elle disparaît tout de suite de tes révisions"], ["mal_posee", "Mal posée ou ambiguë", ""], ["fausse", "Réponse ou correction fausse", ""], ["explication", "Explication pas claire", ""], ["autre", "Autre", ""]];
function feuilleSignaler(k) {
	const x = item(k); if (!x?.it) return;
	const apercu = x.it.recto || x.it.question || x.it.terme || x.it.nom || x.it.enonce || x.it.titre || x.it.consigne || "";
	ouvrirFeuille(`<h3>Signaler cette question</h3>
		<p class="petit">${inline(h(String(apercu).slice(0, 140)))}${String(apercu).length > 140 ? "…" : ""}</p>
		<div class="r-raisons">${RAISONS.map(([v, l, d], i) => `<label class="choix"><input type="radio" name="sig" value="${v}" ${i === 0 ? "checked" : ""}><span>${h(l)}${d ? `<br><span class="petit">${h(d)}</span>` : ""}</span></label>`).join("")}</div>
		<label for="sig-txt">Précise si tu veux (facultatif)</label><textarea id="sig-txt" rows="3" placeholder="Ex. deux réponses sont justes"></textarea>
		<div class="actions"><button class="bouton" data-fermer>Annuler</button><button class="bouton plein" data-r-sig-ok="${h(k)}">Envoyer</button></div>
		<p class="petit">La tâche de nuit corrige ou retire la question.</p>`);
}
async function envoyerSignalement(k) {
	const raison = document.querySelector('input[name="sig"]:checked')?.value || "autre";
	const commentaire = ($("#sig-txt")?.value || "").trim();
	const s = { id: uid(), cle: k, raison, commentaire, statut: "en_attente", le: new Date().toISOString() };
	fermerFeuille();
	S.data.revision.signalements = [...(S.data.revision.signalements || []), s];
	const carte = document.querySelector(`[data-r-signaler="${CSS.escape(k)}"]`)?.closest(".r-carte");
	if (carte) { carte.querySelector(".r-signaler").outerHTML = `<span class="r-signale">✓ Signalé</span>`; }
	if (raison === "inutile") appliquerMasques();
	alerteDouce(raison === "inutile" ? "Merci ! Cette question ne te sera plus proposée." : "Merci ! Elle sera revue cette nuit.");
	try { await modifier("revision/signalements.json", "signalements", (l) => [...l, s], "Signalement d'une question", { cible: "revision", sansSynchro: true }); }
	catch { alerteDouce("Signalement non envoyé (hors ligne ?) : réessaie plus tard."); }
}
document.addEventListener("click", (e) => {
	const a = e.target.closest("[data-r-signaler]");
	if (a) { e.preventDefault(); e.stopPropagation(); feuilleSignaler(a.dataset.rSignaler); return; }
	const ok = e.target.closest("[data-r-sig-ok]");
	if (ok) { e.preventDefault(); envoyerSignalement(ok.dataset.rSigOk); }
}, true);

function fusionProgres(a = {}, b = {}) {
	const out = { ...a };
	for (const [k, v] of Object.entries(b)) if (!out[k] || (v.maj || "") > (out[k].maj || "")) out[k] = v;
	return out;
}
let progresTimer;
function sauverProgres() {
	store.set("ae.progres.local", S.data.progres);
	clearTimeout(progresTimer);
	progresTimer = setTimeout(async () => {
		try {
			const local = S.data.progres;
			await modifier("revision/progres.json", "progres", (dist) => fusionProgres(dist, local), "Progrès de révision", { defaut: {}, sansSynchro: true });
			store.set("ae.progres.local", {});
		} catch {}
	}, 8000);
}
const cle = (chapId, itemId) => `${chapId}:${itemId}`;
function item(k) { const [c, i] = k.split(":"); const ch = R.chap[c]; return ch && { ch, it: (ch.items || []).find((x) => x.id === i) }; }
function noter(k, niveau) {
	// niveau : 0 = raté, 1 = juste, 2 = facile
	const p = S.data.progres[k] || { boite: 0, vu: 0, ok: 0, ko: 0 };
	p.vu++;
	if (niveau === 0) { p.boite = 1; p.ko++; } else { p.boite = Math.min(5, (p.boite || 0) + niveau); p.ok++; }
	p.prochaine = ajouterJours(auj(), BOITES[p.boite]);
	p.maj = new Date().toISOString();
	S.data.progres[k] = p;
	sauverProgres();
}
const estDu = (k) => { const p = S.data.progres[k]; return !p || !p.prochaine || p.prochaine <= auj(); };
const tousItems = () => Object.values(R.chap).flatMap((ch) => (ch.items || []).map((it) => ({ ch, it, k: cle(ch.id, it.id) })));
function maitrise(ch) {
	const its = (ch.items || []).filter((it) => RECALL.includes(it.type) || EXOS.includes(it.type));
	if (!its.length) return 0;
	const s = its.reduce((a, it) => a + Math.min(1, ((S.data.progres[cle(ch.id, it.id)] || {}).boite || 0) / 3), 0);
	return Math.round((100 * s) / its.length);
}
function partielDe(ch) {
	const p = partielsTous().find((x) => jourCle(x.debut) >= auj() && x.matiere && appartient(x.matiere, ch.ue));
	return p ? joursEntre(auj(), jourCle(p.debut)) : null;
}

// ---------- Partiels ----------
function chapitresAuto(matiere) {
	if (!matiere) return [];
	const [ue, sous] = matiere.split(" / ");
	const chs = Object.values(R.chap).filter((c) => !c.partiel && c.ue === ue);
	const precis = sous ? chs.filter((c) => norm(c.matiere) === norm(sous)) : [];
	return precis.length ? precis : chs;
}
function chapitresPartiel(p) {
	const base = Array.isArray(p.chapitres) && p.chapitres.length ? p.chapitres.map((id) => R.chap[id]).filter(Boolean) : chapitresAuto(p.matiere);
	const dedie = Object.values(R.chap).find((c) => c.partiel === p.id);
	return dedie ? [dedie, ...base] : base;
}
const trouverPartiel = (id) => partielsTous().find((p) => p.id === id);
function preparation(chs) {
	const its = chs.flatMap((ch) => (ch.items || []).filter((it) => RECALL.includes(it.type) || EXOS.includes(it.type)).map((it) => cle(ch.id, it.id)));
	if (!its.length) return 0;
	return Math.round((100 * its.reduce((a, k) => a + Math.min(1, ((S.data.progres[k] || {}).boite || 0) / 3), 0)) / its.length);
}

// ---------- Texte et formules ----------
function md(t = "") {
	const lignes = h(t).split("\n");
	let html = "", liste = false;
	for (const l of lignes) {
		const b = l.match(/^\s*[-•]\s+(.*)/);
		if (b) { if (!liste) { html += "<ul>"; liste = true; } html += `<li>${inline(b[1])}</li>`; continue; }
		if (liste) { html += "</ul>"; liste = false; }
		if (/^###\s/.test(l)) html += `<h4>${inline(l.replace(/^###\s/, ""))}</h4>`;
		else if (l.trim()) html += `<p>${inline(l)}</p>`;
	}
	return html + (liste ? "</ul>" : "");
}
const inline = (s) => {
	// `code` d'abord (son contenu n'est pas interprété : a**2 reste a**2)
	const codes = [];
	s = s.replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
	s = s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, "$1<i>$2</i>");
	return s.replace(/\u0000(\d+)\u0000/g, (m, i) => `<code class="ic">${codes[i]}</code>`);
};
function formules(el) {
	if (!el || !window.renderMathInElement) return;
	try {
		window.renderMathInElement(el, { delimiters: [{ left: "$$", right: "$$", display: true }, { left: "$", right: "$", display: false }], throwOnError: false });
	} catch {}
}
function proche(a, b) {
	// vrai si a et b diffèrent d'au plus une lettre (mots de 6 lettres ou plus)
	if (a === b) return true;
	if (Math.min(a.length, b.length) < 6 || Math.abs(a.length - b.length) > 1) return false;
	let i = 0, j = 0, diff = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) { i++; j++; continue; }
		if (++diff > 1) return false;
		if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
	}
	return diff + (a.length - i) + (b.length - j) <= 1;
}
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function nombre(s) { const v = parseFloat(String(s).replace(/\s/g, "").replace(",", ".").replace(/×10\^?/, "e")); return isNaN(v) ? null : v; }
const src = (it, ch) => (it.source || ch.sources?.[0]?.fichier ? `<div class="r-src">Source : ${h([ch.sources?.[0]?.fichier, it.source].filter(Boolean).join(" · "))}</div>` : "");

function lienClaude(ch, it, extra = "") {
	const contexte = `Je suis étudiant à l'ENSAM et je révise « ${ch.titre} » (${ch.ue}${ch.matiere ? " / " + ch.matiere : ""}).`;
	let corps = "";
	if (it.type === "calcul") corps = `Voici l'exercice :\n${it.enonce}${it.donnees ? "\nDonnées : " + it.donnees : ""}${extra ? "\n\nMa démarche :\n" + extra : ""}\n\nGuide-moi étape par étape sans me donner directement la réponse : pose-moi des questions, vérifie mes calculs et mes unités.`;
	else if (it.type === "principe") corps = `Je dois expliquer ce principe : ${it.question}\n\nVoici mon explication :\n${extra || "(pas encore écrite)"}\n\nCorrige-la comme un professeur : ce qui est juste, ce qui manque, ce qui est faux, avec un exemple concret.`;
	else if (it.type === "resume" || it.type === "memoire") corps = `Consigne : ${it.consigne}\n\nVoici mon résumé :\n${extra || "(pas encore écrit)"}\n\nValide-le : points clés présents, oublis, erreurs, et note sur 10.`;
	else if (it.type === "qcm") corps = `QCM : ${it.question}\nChoix : ${it.choix.map((c, i) => `${String.fromCharCode(65 + i)}. ${c}`).join(" ; ")}\n\nExplique-moi le raisonnement sans me donner tout de suite la réponse.`;
	else corps = `Explique-moi en détail, avec un exemple concret : ${it.recto || it.terme || it.nom || it.question || it.titre || ""}`;
	return "https://claude.ai/new?q=" + encodeURIComponent(`${contexte}\n\n${corps}\n\nAppuie-toi sur le cours de mon professeur et signale toute hypothèse.`);
}
const boutonClaude = (ch, it, extra) => `<a class="bouton petit-b r-claude" href="${h(lienClaude(ch, it, extra))}" target="_blank" rel="noopener" data-r-claude="${h(cle(ch.id, it.id))}">✦ Résoudre avec Claude</a>`;



// ---------- Glossaire automatique des variables ----------
// Dictionnaire construit à partir des tableaux de variables des équations et des « termes » des aides
const BASE_SYMBOLES = {
	"\\sigma": ["contrainte normale", "MPa"], "\\tau": ["contrainte tangentielle (cisaillement)", "MPa"], "\\varepsilon": ["déformation (allongement relatif)", "sans unité"],
	"E": ["module d'Young (rigidité du matériau)", "MPa ou GPa"], "G": ["module de cisaillement", "MPa"], "\\nu": ["coefficient de Poisson", "sans unité"],
	"N": ["effort normal", "N"], "F": ["force", "N"], "L": ["longueur", "mm ou m"], "\\Delta L": ["allongement", "mm"], "I": ["moment quadratique", "mm⁴"],
	"\\rho": ["masse volumique", "kg/m³ ou g/cm³"], "T": ["température absolue ou effort tranchant (selon le contexte)", "K ou N"], "R": ["constante des gaz parfaits 8,314 (ou rayon selon le contexte)", "J/(mol·K)"],
	"\\varphi": ["fraction volumique de renfort", "sans unité"], "\\alpha": ["coefficient de dilatation (ou angle selon le contexte)", "°C⁻¹"], "\\eta": ["viscosité", "Pa·s"],
	"M_f": ["moment fléchissant", "N·mm"], "M_t": ["moment de torsion", "N·mm"], "I_0": ["moment quadratique polaire", "mm⁴"], "T_y": ["effort tranchant", "N"], "S": ["aire de la section", "mm²"],
	"\\theta": ["angle", "rad"], "\\gamma": ["glissement (angle)", "rad"], "\\lambda": ["coefficient de Lamé ou taux d'élongation", "—"], "\\mu": ["coefficient de Lamé", "Pa"],
};
const normSym = (x) => String(x).replace(/\$/g, "").replace(/\\[,;! ]/g, "").replace(/\\(mathrm|text)\{([^}]*)\}/g, "$2").replace(/\s+/g, "").replace(/[{}]/g, "").replace(/\(.*\)$/, "");
let DICO = null;
function dico() {
	if (DICO) return DICO;
	DICO = {};
	const ajoute = (cle, sens, unite, chId) => {
		for (const k of String(cle).split(/,\s*/)) {
			const n = normSym(k.replace(/\s*\(.*\)\s*$/, ""));
			if (!n || n.length > 14) continue;
			(DICO[n] ||= []).push({ sens, unite: unite || "", chId });
		}
	};
	// d'abord les tableaux de variables des équations (plus précis), puis les termes des aides
	for (const ch of Object.values(R.chap)) for (const it of ch.items || []) (it.variables || []).forEach(([sy, sens, u]) => ajoute(sy, sens, u, ch.id));
	for (const ch of Object.values(R.chap)) for (const it of ch.items || []) (it.aide?.termes || []).forEach(([t, sens]) => { const m = String(t).match(/^\$([^$]+)\$/); if (m && !/,/.test(m[1])) ajoute(m[1], sens, "", ch.id); });
	return DICO;
}
function symbolesDe(it) {
	const textes = [it.recto, it.verso, it.terme, it.definition, it.question, ...(it.choix || []), it.explication, it.enonce, it.donnees, it.solution, it.formule ? "$" + it.formule + "$" : "", it.texte, ...(it.indices || [])].filter(Boolean).join(" ");
	const out = new Set();
	for (const m of textes.matchAll(/\$\$?([^$]+)\$\$?/g)) {
		const f = m[1].replace(/\\(frac|dfrac|tfrac|sqrt|left|right|cdot|times|approx|le|leq|ge|geq|quad|qquad|Rightarrow|to|partial|int|sum|exp|ln|cos|sin|tan|mathrm|text|underline|vec|pm|infty|xrightarrow|begin|end|pmatrix|forall|in|ldots|cdots|operatorname|max|min)(?![A-Za-z])/g, " ");
		for (const t of f.matchAll(/\\Delta\s*[A-Za-z](?:_\{[^}]*\}|_[A-Za-z0-9])?|\\[A-Za-z]+(?:_\{[^}]*\}|_[A-Za-z0-9])?|[A-Za-z](?:_\{[^}]*\}|_[A-Za-z0-9]+)?/g)) {
			const n = normSym(t[0]);
			if (/^(d|x|y|z|e|i|j|k|m|n|s)$/.test(n) && !dico()[n]) continue; // variables muettes, unités
			if (/^(MPa|GPa|mm|kN|mol|Pa|kg|cm)$/.test(n)) continue;
			out.add(n);
		}
	}
	return [...out];
}
function glossaire(ch, it) {
	const lignes = [];
	for (const sy of symbolesDe(it)) {
		const cands = dico()[sy] || [];
		// une lettre seule n'a de sens que dans le même chapitre ou la même UE (S = section en RDM, mais pas ailleurs)
		const c = cands.find((x) => x.chId === ch.id) || cands.find((x) => R.chap[x.chId]?.ue === ch.ue) || (sy.length > 1 ? cands[0] : null);
		const base = BASE_SYMBOLES[sy] || BASE_SYMBOLES[sy.replace(/_.*/, "")];
		const sens = c?.sens || base?.[0], unite = c?.unite || base?.[1] || "";
		if (sens && !lignes.some((l) => l.sy === sy)) lignes.push({ sy, sens, unite });
	}
	if (!lignes.length) return "";
	return `<div class="r-aide-t">🔤 Les variables</div><table class="r-vars">${lignes.map((l) => `<tr><td>$${h(l.sy.replace(/_([^{])(.+)/, "_{$1$2}"))}$</td><td>${inline(h(l.sens))}</td><td class="petit">${h(l.unite)}</td></tr>`).join("")}</table>`;
}

// ---------- Photo d'une résolution (compressée avant envoi) ----------
R.photos = {};
function compresserImage(fichier, max = 1600) {
	return new Promise((ok, ko) => {
		const img = new Image();
		img.onload = () => {
			const r = Math.min(1, max / Math.max(img.width, img.height));
			const cv = document.createElement("canvas");
			cv.width = Math.round(img.width * r); cv.height = Math.round(img.height * r);
			cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
			ok(cv.toDataURL("image/jpeg", 0.75));
			URL.revokeObjectURL(img.src);
		};
		img.onerror = ko;
		img.src = URL.createObjectURL(fichier);
	});
}
async function envoyerImage(chemin, dataUrl, message) {
	const res = await api(`repos/${DATA_REPO}/contents/${chemin}`, { method: "PUT", body: JSON.stringify({ message, content: dataUrl.split(",")[1] }) });
	if (!res.ok) throw new Error(`Envoi de la photo impossible (${res.status})`);
}
const zonePhoto = (k) => `<label class="bouton petit-b r-photo-b">📷 Photo<input type="file" accept="image/*" data-r-photo="${h(k)}" hidden></label><div class="r-apercu" id="p-${h(k)}"></div>`;

// ---------- Écriture (dictée), schémas, niveaux de difficulté ----------
const RECO = window.SpeechRecognition || window.webkitSpeechRecognition;
const NIVEAUX = ["", "Base", "Intermédiaire", "Avancé"];
const niveauDe = (it) => Math.min(3, Math.max(1, Number(it.niveau) || 1));
const figure = (it) => (it.schema ? `<figure class="r-schema">${it.schema}${it.schemaLegende ? `<figcaption class="petit">${inline(h(it.schemaLegende))}</figcaption>` : ""}</figure>` : "");
// Niveau accessible : selon la maîtrise du chapitre ; tout est débloqué à l'approche d'un partiel de la matière
function niveauAutorise(ch) {
	const j = partielDe(ch);
	if (j != null && j <= 7) return 3;
	const m = maitrise(ch);
	return m >= 70 ? 3 : m >= 35 ? 2 : 1;
}
// Score de tri : plus il est petit, plus l'élément passe en premier (peu maîtrisé, niveau accessible)
// Priorité à la compréhension : formules, phénomènes, exercices (surtout ceux du cours et des TD) avant le par-cœur
const POIDS_TYPE = { calcul: -1.5, equation: -1.2, principe: -1.2, qcm: -0.4, trous: 0, resume: 0.3, memoire: 0.3, flash: 0.7, definition: 0.9, fiche: 1.5 };
const estComprendre = (it) => ["calcul", "equation", "principe"].includes(it.type) || !!it.td || !!it.phenomene;
function scoreItem(x, cache = {}) {
	if (!(x.ch.id in cache)) cache[x.ch.id] = niveauAutorise(x.ch);
	const boite = (S.data.progres[x.k] || {}).boite || 0;
	return boite + (niveauDe(x.it) <= cache[x.ch.id] ? 0 : 10) + (POIDS_TYPE[x.it.type] ?? 0) + (x.it.td ? -1 : 0) + (x.it.phenomene ? -0.8 : 0);
}
// Zone de réponse écrite : grande, avec dictée quand le navigateur la permet (sinon le micro du clavier iOS)
function zoneEcriture(k, placeholder) {
	const brouillon = (R.brouillons || {})[k] || "";
	return `<div class="r-ecrire">
		<textarea class="r-texte" id="x-${h(k)}" data-r-brouillon="${h(k)}" placeholder="${h(placeholder)}" autocapitalize="sentences" spellcheck="true">${h(brouillon)}</textarea>
		<div class="r-outils">${RECO ? `<button type="button" class="bouton petit-b" data-r-dicter="${h(k)}">🎙️ Dicter</button>` : ""}<span class="petit">${RECO ? "" : "Touche le 🎤 du clavier pour dicter. "}Pas envie d'écrire ? Explique à voix haute, puis coche les points clés plus bas.</span></div>
	</div>`;
}
// Points clés à cocher : on écrit moins, on s'auto-évalue
const checklist = (k, attendus = [], modele) => (attendus.length ? `<details class="r-checks">
		<summary>✅ J'ai fini : comparer aux points clés</summary>
		${attendus.map((a, i) => `<label class="choix"><input type="checkbox" data-r-att="${h(k)}" value="${i}"><span>${inline(h(a))}</span></label>`).join("")}
		<div class="r-actions"><button class="bouton plein petit-b" data-r-score="${h(k)}">Enregistrer mon score</button></div>
		${modele ? `<details class="r-modele"><summary class="petit">Voir une réponse modèle</summary><div class="r-md">${md(modele)}</div></details>` : ""}
	</details>` : "");
let REC = null;
function dicter(k, btn) {
	if (REC) { REC.stop(); return; }
	const zone = $(`#x-${CSS.escape(k)}`);
	if (!zone) return;
	const r = new RECO();
	r.lang = "fr-FR"; r.continuous = true; r.interimResults = false;
	r.onresult = (ev) => {
		let t = "";
		for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) t += ev.results[i][0].transcript;
		if (!t.trim()) return;
		zone.value = (zone.value.trim() ? zone.value.trimEnd() + " " : "") + t.trim();
		zone.dispatchEvent(new Event("input", { bubbles: true }));
	};
	r.onerror = (ev) => alerteDouce(ev.error === "not-allowed" ? "Autorise le micro dans les réglages de ton navigateur." : "Dictée interrompue : réessaie, ou utilise le micro du clavier.");
	r.onend = () => { REC = null; btn.textContent = "🎙️ Dicter"; };
	REC = r;
	btn.textContent = "⏹ Arrêter";
	r.start();
}
// Banque de mots pour les textes à trous : les bonnes réponses, plus quelques leurres pris ailleurs dans le chapitre
function banqueMots(ch, it, k) {
	const mots = (texte) => (String(texte).match(/\[\[(.+?)\]\]/g) || []).map((m) => m.slice(2, -2).split("|")[0]);
	const bonnes = mots(it.texte);
	const autres = (ch.items || []).filter((x) => x.type === "trous" && x.id !== it.id).flatMap((x) => mots(x.texte));
	const leurres = [...new Set(autres.filter((m) => !bonnes.includes(m)))].sort(() => Math.random() - 0.5).slice(0, 3);
	const liste = [...bonnes, ...leurres].sort(() => Math.random() - 0.5);
	return `<div class="r-banque" id="b-${h(k)}" hidden>${liste.map((m) => `<button type="button" class="r-chip" data-r-chip="${h(k)}" data-mot="${h(m)}">${h(m)}</button>`).join("")}<p class="petit">Touche un mot pour le placer dans le trou sélectionné (ou le premier trou vide). Les mots qui ne vont pas restent en rouge.</p></div>`;
}

// Touches absentes du pavé numérique iOS : signe moins et puissance de 10
const clavierPlus = (id) => `<span class="r-touches"><button type="button" class="r-touche" data-r-touche="${h(id)}" data-t="-">−</button><button type="button" class="r-touche" data-r-touche="${h(id)}" data-t="e">×10ⁿ</button></span>`;
// Calcul guidé : une case par étape, vérifiée au fur et à mesure (méthode de l'exemple « estompé »)
function etapes(it, k) {
	if (!(it.etapes || []).length) return "";
	return `<ol class="r-etapes">${it.etapes.map((e, i) => `<li class="r-etape"><div class="r-md">${md(e.question)}</div>
		<div class="r-rep"><input type="text" inputmode="decimal" id="e-${h(k)}-${i}" data-r-etape="${h(k)}" data-i="${i}" placeholder="Valeur"><span>${h(e.unite || "")}</span>${clavierPlus(`e-${k}-${i}`)}<button class="bouton petit-b" data-r-etape-v="${h(k)}" data-i="${i}">✓</button></div>
		<div class="r-retour" id="er-${h(k)}-${i}"></div></li>`).join("")}</ol>`;
}
function corrigerEtape(k, i) {
	const x = item(k); if (!x?.it) return;
	const e = x.it.etapes[i], champ = $(`#e-${CSS.escape(k)}-${i}`), zone = $(`#er-${CSS.escape(k)}-${i}`);
	const v = nombre(champ.value), att = Number(e.valeur), tol = e.tolerance ?? 0.02;
	if (v == null) { zone.innerHTML = `<div class="r-msg ko">Entre un nombre.</div>`; return; }
	const ok = att === 0 ? Math.abs(v) < 1e-9 : Math.abs(v - att) / Math.abs(att) <= tol;
	champ.classList.toggle("bon", ok); champ.classList.toggle("faux", !ok);
	zone.innerHTML = ok ? `<div class="r-msg ok">✓ Juste${e.apres ? " · " + inline(h(e.apres)) : ""}</div>` : `<div class="r-msg ko">✗ Pas encore.${e.indice ? ` <button type="button" class="lien" data-r-etape-ind="${h(k)}" data-i="${i}">Un coup de pouce ?</button>` : ""}</div>`;
	formules(zone);
	if (ok) $(`#e-${CSS.escape(k)}-${i + 1}`)?.focus();
}

// Ordre des choix d'un QCM mélangé à chaque affichage (la bonne réponse n'est jamais toujours au même endroit).
// Les choix du type « toutes les réponses » / « aucune » restent en dernier.
function melangerChoix(it) {
	const fin = (c) => /^(toutes|aucune|aucun|les deux|tous)\b/i.test(String(c).trim());
	const idx = it.choix.map((_, i) => i), libres = idx.filter((i) => !fin(it.choix[i])), fixes = idx.filter((i) => fin(it.choix[i]));
	for (let i = libres.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [libres[i], libres[j]] = [libres[j], libres[i]]; }
	return [...libres, ...fixes];
}

// ---------- Rendu d'un élément ----------
function carteItem(ch, it, mode = "liste") {
	const k = cle(ch.id, it.id);
	const deja = (S.data.revision?.signalements || []).some((x) => x.cle === k && x.statut === "en_attente");
	const tete = `<div class="r-tete"><div class="r-type" style="--c:${couleur(ch.ue)}">${TYPES[it.type] || it.type} · <span class="r-niv">${NIVEAUX[niveauDe(it)]}</span>${it.td ? ` · <span class="r-badge-td">${h(it.td)}</span>` : it.phenomene ? ' · <span class="r-badge-td">🔬 phénomène</span>' : ""}</div>${it.type === "fiche" ? "" : deja ? `<span class="r-signale">✓ Signalé</span>` : `<button type="button" class="r-signaler" data-r-signaler="${h(k)}" aria-label="Signaler un problème sur cette question">?</button>`}</div>`;
	const indices = (it.indices || []).length ? `<button class="bouton petit-b" data-r-indice="${h(k)}">💡 Indice</button><div class="r-indices" id="ind-${h(k)}"></div>` : "";
	switch (it.type) {
		case "fiche":
			return `<div class="r-carte">${tete}<h3>${h(it.titre)}</h3><div class="r-md">${md(it.contenu)}</div>
${src(it, ch)}</div>`;
		case "equation":
			if (mode === "session") return `<div class="r-carte">${tete}<h3>${h(it.nom)}</h3>${it.quand ? `<p class="petit">${h(it.quand)}</p>` : ""}
				<div class="r-md">${md(it.question || "Écris la formule de tête (sur papier ou dans ta tête), puis vérifie.")}</div><div class="r-cache" id="v-${h(k)}" hidden>${formuleBloc(it)}</div>
				<div class="r-actions"><button class="bouton plein" data-r-montrer="${h(k)}">Voir la formule</button></div>${notation(k)}${blocAide(ch, it, k)}</div>`;
			return `<div class="r-carte">${tete}<h3>${h(it.nom)}</h3>${formuleBloc(it)}${figure(it)}${it.quand ? `<p class="petit">${h(it.quand)}</p>` : ""}${blocAide(ch, it, k, false)}${src(it, ch)}</div>`;
		case "definition":
		case "flash": {
			const recto = it.type === "flash" ? it.recto : it.terme, verso = it.type === "flash" ? it.verso : it.definition;
			if (mode === "liste" && it.type === "definition") return `<div class="r-carte">${tete}<h3>${h(recto)}</h3><div class="r-md">${md(verso)}</div>${blocAide(ch, it, k, false)}${src(it, ch)}</div>`;
			return `<div class="r-carte r-flash">${tete}<div class="r-recto">${md(recto)}</div>
				<div class="r-cache" id="v-${h(k)}" hidden><hr><div class="r-md">${md(verso)}</div>${src(it, ch)}</div>
				<div class="r-actions"><button class="bouton plein" data-r-montrer="${h(k)}">Retourner la carte</button></div>${notation(k)}${blocAide(ch, it, k)}</div>`;
		}
		case "qcm":
			return `<div class="r-carte">${tete}<div class="r-md">${md(it.question)}</div>${figure(it)}
				<div class="r-choix">${melangerChoix(it).map((i, pos) => `<button class="r-choix-b" data-r-qcm="${h(k)}" data-i="${i}">${String.fromCharCode(65 + pos)}. ${inline(h(it.choix[i]))}</button>`).join("")}</div>
				<div class="r-retour" id="r-${h(k)}"></div>${blocAide(ch, it, k)}<div class="r-actions">${boutonClaude(ch, it)}</div></div>`;
		case "trous": {
			let n = 0;
			const html = h(it.texte).replace(/\[\[(.+?)\]\]/g, (_, rep) => `<input class="r-trou" data-rep="${rep}" data-n="${n++}" data-r-trou-de="${h(k)}" enterkeyhint="next" size="${Math.max(4, rep.split("|")[0].length)}" autocomplete="off" autocapitalize="off" spellcheck="false">`);
			return `<div class="r-carte">${tete}${it.titre ? `<h3>${h(it.titre)}</h3>` : ""}<div class="r-trous" id="t-${h(k)}">${html}</div>
				<div class="r-retour" id="r-${h(k)}"></div>${blocAide(ch, it, k)}
				<div class="r-actions"><button class="bouton petit-b" data-r-banque="${h(k)}">🔤 Banque de mots</button><button class="bouton petit-b" data-r-solution="${h(k)}">Voir les réponses</button></div>${banqueMots(ch, it, k)}${src(it, ch)}</div>`;
		}
		case "calcul":
			return `<div class="r-carte">${tete}<div class="r-md">${md(it.enonce)}</div>${figure(it)}${it.donnees ? `<div class="r-donnees">${md(it.donnees)}</div>` : ""}
				${etapes(it, k)}
				<div class="r-rep">${(it.etapes || []).length ? `<span class="petit">Résultat final</span>` : ""}<input type="text" inputmode="decimal" enterkeyhint="done" id="c-${h(k)}" data-r-calc="${h(k)}" placeholder="Ta valeur (ex. 63,7)"><span>${h(it.reponse?.unite || "")}</span>${clavierPlus(`c-${k}`)}<button class="bouton plein petit-b" data-r-verifier="${h(k)}">Vérifier</button></div>
				<div class="r-retour" id="r-${h(k)}"></div>${blocAide(ch, it, k)}
				<div class="r-actions">${indices}</div>
				<div class="r-actions">${boutonClaude(ch, it)}<button class="bouton petit-b" data-r-solution="${h(k)}">Solution</button></div>
				<div class="r-cache" id="s-${h(k)}" hidden><div class="r-md">${md(it.solution || "")}</div>${glossaire(ch, it)}</div>
				<details class="r-rendu"><summary class="petit">📤 Rendre une résolution complète (texte ou photo) pour correction</summary>
					<textarea class="r-texte" id="x-${h(k)}" data-r-brouillon="${h(k)}" placeholder="Écris ta démarche, ou joins une photo de ta feuille / ton schéma…">${h((R.brouillons || {})[k] || "")}</textarea>
					<div class="r-actions">${zonePhoto(k)}<button class="bouton plein petit-b" data-r-envoyer="${h(k)}">Envoyer pour correction</button><a class="bouton petit-b" href="#" data-r-claude-txt="${h(k)}">✦ Corriger avec Claude</a></div>
					${statutRendu(k)}
				</details>${src(it, ch)}</div>`;
		case "principe":
		case "resume":
		case "memoire": {
			const q = it.type === "principe" ? it.question : it.consigne;
			const ph = it.type === "principe" ? "Explique avec tes mots, comme à un camarade…" : it.type === "resume" ? "Écris ton résumé, avec tes mots…" : "Écris tout ce dont tu te souviens…";
			return `<div class="r-carte">${tete}<div class="r-md">${md(q)}</div>
				${it.type === "memoire" ? `<p class="petit">Sans regarder le cours : écris tout ce dont tu te souviens, puis compare. <button class="bouton petit-b" data-r-chrono="${h(k)}">⏱ Lancer 5 min</button> <span id="ch-${h(k)}"></span></p>` : ""}
				${zoneEcriture(k, ph)}
				${checklist(k, it.attendus, it.modele)}
				${indices ? `<div class="r-actions">${indices}</div>` : ""}
				<div class="r-actions">${zonePhoto(k)}<button class="bouton petit-b" data-r-envoyer="${h(k)}">📤 Envoyer pour validation</button><a class="bouton petit-b" href="#" data-r-claude-txt="${h(k)}">✦ Valider avec Claude</a></div>
				${statutRendu(k)}
				${it.aide ? blocAide(ch, it, k) : ""}
				${src(it, ch)}</div>`;
		}
	}
	return "";
}
function lienExplication(ch, it) {
	const quoi = it.recto || it.terme || it.nom || it.question || it.titre || it.enonce || "";
	return "https://claude.ai/new?q=" + encodeURIComponent(`Je suis étudiant à l'ENSAM et je révise « ${ch.titre} » (${ch.ue}). Explique-moi cet élément :\n${quoi}${it.formule ? "\nFormule : " + it.formule : ""}\n\n1) en mots simples (le phénomène physique), 2) avec un exemple concret, 3) le sens de chaque lettre ou terme avec son unité, 4) ce qui se passe quand on fait varier chaque paramètre (avec des chiffres). Appuie-toi sur un cours de mécanique de niveau ingénieur.`);
}
// ---------- Vocabulaire anglais (petit encadré après chaque résolution) ----------
let LEX = null;
const sansAccent = (t) => String(t).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[’']/g, "'").replace(/œ/g, "oe");
function lexique() {
	if (LEX) return LEX;
	const termes = (store.get("ae.lexique", { termes: [] }).termes || []).filter(([fr, en]) => sansAccent(fr) !== sansAccent(en));
	// chaque mot peut prendre un s/x final (pluriel) ; les plus longs d'abord pour éviter les chevauchements
	LEX = termes.map(([fr, en]) => ({ fr, en, re: new RegExp(`(^|[^a-z0-9])${sansAccent(fr).split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[sx]?").join("[\\s-]+")}(?![a-z0-9])`) })).sort((a, b) => b.fr.length - a.fr.length);
	return LEX;
}
function motsAnglais(ch, it) {
	if (ch.ue === "LV1" || /^lv1-|toeic/i.test(ch.id)) return []; // déjà en anglais
	if (Array.isArray(it.anglais) && it.anglais.length) return it.anglais.slice(0, 6);
	const nettoie = (v) => sansAccent(String(v || "").replace(/\$[^$]*\$/g, " ").replace(/\*\*/g, ""));
	const question = nettoie([it.recto, it.question, it.terme, it.nom, it.enonce, it.titre, it.consigne].filter(Boolean).join(" "));
	const reponse = nettoie([it.verso, it.definition, it.explication, it.solution, it.quand, it.choix ? it.choix[it.bonne] : "", it.texte?.replace(/\[\[([^|\]]+)[^\]]*\]\]/g, "$1"), ...(it.attendus || [])].filter(Boolean).join(" "));
	const pris = [], couvert = [];
	for (const zone of [question, reponse]) {
		let txt = zone;
		for (const t of lexique()) {
			if (pris.length >= 5) break;
			if (pris.some((p) => p.fr === t.fr)) continue;
			const m = txt.match(t.re);
			if (!m) continue;
			if (couvert.some((c) => sansAccent(c).includes(sansAccent(t.fr)))) continue;
			pris.push(t); couvert.push(t.fr);
			txt = txt.replace(t.re, "$1 ");
		}
	}
	// pas « ajustement » si « ajustement avec jeu » est déjà là
	return pris.filter((t) => !pris.some((u) => u !== t && sansAccent(u.fr).includes(sansAccent(t.fr)))).map((t) => [t.fr, t.en]);
}
function encadreAnglais(ch, it, k, cache) {
	const mots = motsAnglais(ch, it);
	if (!mots.length) return "";
	return `<div class="r-en" id="en-${h(k)}" ${cache ? "hidden" : ""}><span class="r-en-t">🇬🇧 In English</span>${mots.map(([fr, en]) => `<span class="r-en-m"><span class="petit">${h(fr)}</span> <b>${h(en)}</b></span>`).join("")}</div>`;
}

function blocAide(ch, it, k, cache = true) {
	const a = it.aide;
	if (!a) return `<details class="r-aide" id="a-${h(k)}" ${cache ? "hidden" : ""}><summary>💡 Comprendre</summary>${glossaire(ch, it)}<p class="petit">L'explication détaillée de cet élément arrive bientôt (ajoutée chaque nuit, chapitres des prochains partiels en premier).</p><a class="bouton petit-b r-claude" href="${h(lienExplication(ch, it))}" target="_blank" rel="noopener">✦ Me l'expliquer avec Claude</a></details>${encadreAnglais(ch, it, k, cache)}`;
	const motsSeuls = (a.termes || []).filter(([t]) => !/^\$/.test(String(t)));
	const termes = motsSeuls.length ? `<div class="r-aide-t">📖 Les mots à connaître</div><table class="r-vars">${motsSeuls.map(([t, sens]) => `<tr><td>${inline(h(t))}</td><td>${inline(h(sens))}</td></tr>`).join("")}</table>` : "";
	const corps = `${a.simple ? `<div class="r-aide-t">🧠 Le phénomène, en mots simples</div><div class="r-md">${md(a.simple)}</div>` : ""}
		${a.champ ? `<div class="r-aide-t">📍 Quand ça s'applique (et quand non)</div><div class="r-md">${md(a.champ)}</div>` : ""}
		${a.piege ? `<div class="r-aide-t">⚠️ Piège fréquent</div><div class="r-md">${md(a.piege)}</div>` : ""}
		${a.exemple ? `<div class="r-aide-t">🔧 Exemple concret</div><div class="r-md">${md(a.exemple)}</div>` : ""}
		${termes}
		${a.variation ? `<div class="r-aide-t">📈 Et si on fait varier…</div><div class="r-md">${md(a.variation)}</div>` : ""}
		${glossaire(ch, it)}`;
	return `<details class="r-aide" id="a-${h(k)}" ${cache ? "hidden" : ""}><summary>💡 Comprendre</summary>${corps}</details>${encadreAnglais(ch, it, k, cache)}`;
}
function montrerAide(k) {
	const a = $(`#a-${CSS.escape(k)}`);
	if (a) { a.hidden = false; a.open = true; formules(a); }
	const en = $(`#en-${CSS.escape(k)}`); if (en) en.hidden = false;
}
function statutRendu(k) {
	const rendu = (S.data.revision.rendus || []).filter((r) => r.cle === k).sort((a, b) => b.date.localeCompare(a.date))[0];
	if (!rendu) return "";
	return `<div class="r-statut ${rendu.statut}">${rendu.statut === "en_attente" ? "⏳ Envoyé le " + h(fmt(rendu.date, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })) + " · correction cette nuit" : rendu.statut === "valide" ? "✅ Validé" : "✏️ À retravailler"}${rendu.note != null ? ` · ${h(rendu.note)}/10` : ""}${rendu.image ? " · 📷 photo jointe" : ""}${rendu.retour ? `<div class="r-md">${md(rendu.retour)}</div>` : ""}</div>`;
}
function formuleBloc(it) {
	return `<div class="r-formule">$$${h(it.formule)}$$</div>${(it.variables || []).length ? `<table class="r-vars">${it.variables.map(([s, sens, u]) => `<tr><td>$${h(s)}$</td><td>${h(sens)}</td><td class="petit">${h(u || "")}</td></tr>`).join("")}</table>` : ""}`;
}
function notation(k) {
	return `<div class="r-notes" id="n-${h(k)}" hidden><span class="petit">Tu la connaissais ?</span>
		<button class="bouton petit-b" data-r-note="${h(k)}" data-n="0">À revoir</button>
		<button class="bouton petit-b" data-r-note="${h(k)}" data-n="1">Bien</button>
		<button class="bouton petit-b" data-r-note="${h(k)}" data-n="2">Facile</button></div>`;
}

// ---------- Vues ----------
function vueReviser() {
	R.notes = {};
	if (R.session) return vueSession();
	if (R.partiel) { const p = trouverPartiel(R.partiel); if (p) return vuePartiel(p); R.partiel = null; }
	if (R.ouvert === "__python") return vuePython();
	if (R.ouvert && R.chap[R.ouvert]) return vueChapitre(R.chap[R.ouvert]);
	const chs = Object.values(R.chap).filter((c) => !c.partiel);
	if (!chs.length) return `<section class="carte"><h2>Révisions</h2><p class="vide">Aucun chapitre pour l'instant. Les contenus sont générés à partir de tes cours GoodNotes.</p></section>`;
	const dus = tousItems().filter((x) => (RECALL.includes(x.it.type) || EXOS.includes(x.it.type)) && estDu(x.k));
	const rendus = (S.data.revision.rendus || []).slice().sort((a, b) => b.date.localeCompare(a.date));
	const parUe = {};
	for (const ch of chs) (parUe[ch.ue] ||= []).push(ch);
	return `<div class="grille deux">
		<div class="grille">
			<div class="hero r-hero" data-r-session="dus">
				<div class="eti">Aujourd'hui</div>
				<div class="nom">${dus.length ? `${Math.min(25, dus.length)} à revoir aujourd'hui` : "Tout est à jour 🎉"}</div>
				<div class="info">${dus.length ? `Session de 25 max (${dus.length} en attente au total). Ce que tu oublies revient plus souvent.` : "Lance une session mélangée pour t'entraîner."}</div>
			</div>
			<div class="rang"><button class="bouton large" data-r-session="comprendre">🔬 Comprendre : phénomènes, formules, TD</button></div>
			<div class="rang"><button class="bouton large" data-r-session="melange">🔀 Session mélangée</button><button class="bouton large" data-r-prochain-partiel>🎯 Prochain partiel</button></div>
			<div class="ligne cliquable py-entree" data-py-module><div class="py-logo">🐍</div><div class="corps"><div class="t">Python · Salome-Meca &amp; Code_Aster</div><div class="s">Exercices en direct, corrigés, avec résultats et graphiques</div></div><div class="petit">›</div></div>
			<button class="bouton large" data-r-repartition>⚖️ Répartition des matières : ${S.data.config.repartition?.mode === "manuel" ? "personnalisée" : "automatique"}</button>
			${(() => { const ps = partielsTous().filter((p) => jourCle(p.debut) >= auj()); return ps.length ? `<section class="carte"><h2>Mes partiels</h2>${ps.map((p) => { const n = joursEntre(auj(), jourCle(p.debut)), pr = preparation(chapitresPartiel(p)); return `<div class="ligne cliquable" data-partiel-voir="${h(p.id)}"><div class="compte ${n <= 7 ? "proche" : ""}"><b>${n === 0 ? "Auj." : "J-" + n}</b><small>${fmt(p.debut, { day: "numeric", month: "short" })}</small></div><div class="corps"><div class="t">${h(p.titre)}</div><div class="s">${h(p.matiere || "matière à préciser")}${p.description ? " · 📋 attendus" : ""}</div><div class="r-barre"><span style="width:${pr}%"></span></div></div><div class="petit">${pr}%</div></div>`; }).join("")}</section>` : ""; })()}
			${rendus.length ? `<section class="carte"><h2>Mes rendus</h2>${rendus.slice(0, 5).map((r) => { const x = item(r.cle); return `<div class="ligne cliquable" data-r-ouvrir="${h(r.cle.split(":")[0])}"><div class="corps"><div class="t">${h(x?.it ? TYPES[x.it.type] + " · " + (x.ch.titre) : r.cle)}</div><div class="s">${r.statut === "en_attente" ? "⏳ En attente de validation" : r.statut === "valide" ? "✅ Validé" : "✏️ À retravailler"}${r.note != null ? ` · ${h(r.note)}/10` : ""}</div></div></div>`; }).join("")}</section>` : ""}
		</div>
		<div class="grille">${Object.entries(parUe).map(([ue, liste]) => `<section class="carte"><h2>${h(ue)} · ${h(ues().find((u) => u.code === ue)?.nom || "")}</h2>${liste.map((ch) => {
			const m = maitrise(ch), j = partielDe(ch);
			return `<div class="ligne barre cliquable" style="--c:${couleur(ch.ue)}" data-r-ouvrir="${h(ch.id)}"><div class="corps"><div class="t">${h(ch.titre)}</div>
				<div class="s">${h(ch.matiere || "")}${j != null ? ` · <span class="${j <= 14 ? "retard" : ""}">partiel J-${j}</span>` : ""}</div>
				<div class="r-barre"><span style="width:${m}%"></span></div></div><div class="petit">${m}%</div></div>`;
		}).join("")}</section>`).join("")}</div>
	</div>`;
}

function vuePartiel(p) {
	const chs = chapitresPartiel(p), pr = preparation(chs), n = joursEntre(auj(), jourCle(p.debut));
	const dedie = chs.find((c) => c.partiel === p.id);
	const perso = Array.isArray(p.chapitres) && p.chapitres.length;
	return `<button class="bouton petit-b" data-r-retour>‹ Révisions</button>
		<div class="hero" style="margin-top:12px;--c:${couleur(p.matiere)}">
			<span class="dans">${n < 0 ? "Passé" : n === 0 ? "Aujourd'hui" : "J-" + n}</span>
			<div class="eti">Partiel${p.type ? " · " + h(p.type) : ""}</div>
			<div class="nom">${h(p.titre)}</div>
			<div class="info">${h(fmt(p.debut, { weekday: "long", day: "numeric", month: "long" }))}${p.debut.endsWith("T00:00:00") ? "" : " · " + heure(p.debut)}${p.salle ? " · " + h(salle(p.salle)) : ""}${p.matiere ? " · " + h(p.matiere) : ""}</div>
		</div>
		<section class="carte" style="margin-top:14px"><h2>Ce qui tombe</h2>
			${p.description ? `<div class="r-md">${md(p.description)}</div>` : '<p class="vide">Pas encore précisé. Ajoute les attendus pour un module sur mesure.</p>'}
			<div class="r-actions"><button class="bouton petit-b" data-r-modif-partiel="${h(p.id)}">✏️ ${p.description ? "Modifier" : "Préciser"} le partiel</button></div>
		</section>
		<section class="carte" style="margin-top:14px"><h2>Préparation · ${pr}%</h2>
			<div class="r-barre"><span style="width:${pr}%"></span></div>
			<div class="r-actions" style="margin-top:12px">
				<button class="bouton plein" data-r-session="partiel:${h(p.id)}:tout">🎯 Session de révision</button>
				<button class="bouton" data-r-session="partiel:${h(p.id)}:cartes">🃏 Cartes</button>
				<button class="bouton" data-r-session="partiel:${h(p.id)}:exos">✍️ Exercices</button>
				<button class="bouton" data-r-session="partiel:${h(p.id)}:blanc">📝 Test blanc</button>
			</div>
		</section>
		<section class="carte" style="margin-top:14px"><h2>Au programme ${perso ? "(choisi par toi)" : "(automatique)"}</h2>
			${chs.length ? chs.map((ch) => { const m = maitrise(ch); return `<div class="ligne barre cliquable" style="--c:${couleur(ch.ue)}" data-r-ouvrir="${h(ch.id)}"><div class="corps"><div class="t">${ch.partiel ? "⭐ " : ""}${h(ch.titre)}</div><div class="s">${ch.partiel ? "Module généré à partir des attendus" : h(ch.ue + (ch.matiere ? " / " + ch.matiere : ""))}</div><div class="r-barre"><span style="width:${m}%"></span></div></div><div class="petit">${m}%</div></div>`; }).join("") : '<p class="vide">Aucun chapitre ne correspond. Touche « Préciser le partiel » pour choisir la matière ou les chapitres.</p>'}
			${p.description && !dedie ? '<p class="petit" style="margin-top:10px">⏳ Un module d\'exercices ciblés sur tes attendus sera généré cette nuit.</p>' : ""}
		</section>`;
}

function vueChapitre(ch) {
	const par = (t) => (ch.items || []).filter((it) => it.type === t);
	const bloc = (titre, liste, mode = "liste") => (liste.length ? `<h2 class="section-titre r-sec">${titre}</h2><div class="grille">${liste.slice().sort((a, b) => niveauDe(a) - niveauDe(b)).map((it) => carteItem(ch, it, mode)).join("")}</div>` : "");
	const m = maitrise(ch), j = partielDe(ch), na = niveauAutorise(ch);
	return `<button class="bouton petit-b" data-r-retour>‹ Révisions</button>
		<div class="carte r-entete" style="--c:${couleur(ch.ue)};margin-top:12px">
			<div class="petit">${h(ch.ue)}${ch.matiere ? " / " + h(ch.matiere) : ""}${j != null ? ` · partiel J-${j}` : ""} · niveau ${NIVEAUX[na]} ${na < 3 ? `(le niveau suivant s'ouvre à ${na === 1 ? 35 : 70} % de maîtrise)` : "(tout est ouvert)"}</div>
			<h3 style="font:700 22px var(--titre);margin:4px 0 8px">${h(ch.titre)}</h3>
			<div class="r-barre"><span style="width:${m}%"></span></div><div class="petit" style="margin-top:4px">Maîtrise ${m}%${(ch.sources || []).map((s) => s.url ? ` · <a href="${h(s.url)}" target="_blank" rel="noopener">${h(s.fichier)}</a>` : "").join("")}</div>
			<div class="r-actions" style="margin-top:12px">
				<button class="bouton plein" data-r-session="cartes:${h(ch.id)}">🃏 Cartes</button>
				<button class="bouton plein" data-r-session="exos:${h(ch.id)}">✍️ Exercices</button>
				<button class="bouton" data-r-session="tout:${h(ch.id)}">Tout le chapitre</button>
			</div>
		</div>
		${bloc("Fiche mémo", par("fiche"))}
		${bloc("Équations importantes", par("equation"))}
		${bloc("Définitions", par("definition"))}
		${bloc("Cartes", par("flash"), "session")}
		${bloc("QCM", par("qcm"))}
		${bloc("Textes à trous", par("trous"))}
		${bloc("Calculs", par("calcul"))}
		${bloc("Principes à expliquer", par("principe"))}
		${bloc("Résumé à faire", par("resume"))}
		${bloc("Vidage de mémoire", par("memoire"))}`;
}

function vueSession() {
	const s = R.session;
	if (s.i >= s.cles.length) {
		return `<div class="carte" style="text-align:center;padding:30px 20px"><div style="font-size:44px">🎉</div><h3 style="font:700 22px var(--titre)">Session terminée</h3>
			<p class="petit">${s.cles.length} élément${s.cles.length > 1 ? "s" : ""} travaillé${s.cles.length > 1 ? "s" : ""} · ${s.bons} réussi${s.bons > 1 ? "s" : ""}</p>
			<button class="bouton plein large" data-r-fin>Terminer</button></div>`;
	}
	const x = item(s.cles[s.i]);
	if (!x?.it) { s.i++; return vueSession(); }
	return `<div class="nav-semaine"><button class="bouton petit-b" data-r-fin>✕ Quitter</button><strong>${h(s.titre)}</strong><span class="petit">${s.i + 1}/${s.cles.length}</span></div>
		<div class="r-barre" style="margin:6px 0 14px"><span style="width:${Math.round((100 * s.i) / s.cles.length)}%"></span></div>
		<div class="petit" style="margin-bottom:6px">${h(x.ch.titre)}</div>
		${carteItem(x.ch, x.it, "session")}
		<div class="r-actions" style="margin-top:14px"><button class="bouton large ${s.repondu ? "plein" : ""}" data-r-suivant>${s.repondu ? "Suivant ›" : "Passer ›"}</button></div>`;
}

// ---------- Répartition des sessions par UE ----------
function uesAvecChapitres() { return [...new Set(Object.values(R.chap).filter((c) => !c.partiel).map((c) => c.ue))]; }
function repartitionAuto() {
	const out = {};
	const futurs = partielsTous().filter((p) => jourCle(p.debut) >= auj());
	for (const ue of uesAvecChapitres()) {
		const w = futurs.filter((p) => (p.matiere || "").split(" / ")[0] === ue || chapitresPartiel(p).some((c) => c.ue === ue))
			.reduce((a, p) => a + 1 / (1 + joursEntre(auj(), jourCle(p.debut)) / 7), 0);
		out[ue] = 0.25 + w; // chaque UE garde une place minimale
	}
	const tot = Object.values(out).reduce((a, b) => a + b, 0) || 1;
	for (const k in out) out[k] /= tot;
	return out;
}
function repartition() {
	const r = S.data.config.repartition;
	if (r && r.mode === "manuel" && r.parts) {
		const tot = Object.values(r.parts).reduce((a, b) => a + b, 0);
		if (tot > 0) return Object.fromEntries(uesAvecChapitres().map((u) => [u, (r.parts[u] || 0) / tot]));
	}
	return repartitionAuto();
}
// Tire `total` éléments en respectant les parts de chaque UE ; priorité aux éléments les moins maîtrisés
function tirage(candidats, total) {
	const parts = repartition(), cache = {}, sc = new Map();
	// score = maîtrise + niveau trop avancé (pénalité) + un peu de hasard pour varier les sessions
	for (const x of candidats) sc.set(x, scoreItem(x, cache) + (Math.random() - 0.5) * 1.5);
	const parUe = {};
	for (const x of candidats) (parUe[x.ch.ue] ||= []).push(x);
	for (const l of Object.values(parUe)) l.sort((a, b) => sc.get(a) - sc.get(b));
	const choisis = [];
	for (const [ue, f] of Object.entries(parts)) {
		const l = parUe[ue] || [];
		choisis.push(...l.splice(0, Math.round(f * total)));
	}
	const reste = Object.values(parUe).flat().sort((a, b) => sc.get(a) - sc.get(b));
	// une seule question par « famille » (même notion ou même équation) dans une session
	const out = [], familles = new Set();
	for (const x of [...choisis, ...reste]) {
		if (out.length >= total) break;
		if (out.includes(x)) continue;
		const f = x.it.famille;
		if (f && familles.has(f)) continue;
		if (f) familles.add(f);
		out.push(x);
	}
	return out;
}
function feuilleRepartition() {
	const r = S.data.config.repartition || { mode: "auto", parts: {} };
	const auto = repartitionAuto(), ues_ = uesAvecChapitres();
	const val = (u) => (r.mode === "manuel" && r.parts?.[u] != null ? r.parts[u] : Math.round(auto[u] * 100));
	ouvrirFeuille(`<h3>Répartition des sessions</h3>
		<p class="petit">Part de chaque UE dans les sessions « À revoir » et « Mélangée ».</p>
		<form id="f-rep">
			<label class="choix"><input type="radio" name="rep-mode" value="auto" ${r.mode !== "manuel" ? "checked" : ""}><span><b>Automatique</b><br><span class="petit">Plus de place aux partiels proches, mais toutes les UE restent présentes</span></span></label>
			<label class="choix"><input type="radio" name="rep-mode" value="manuel" ${r.mode === "manuel" ? "checked" : ""}><span><b>Je choisis</b><br><span class="petit">Règle le pourcentage de chaque UE</span></span></label>
			<div id="rep-ues">${ues_.map((u) => `<div class="rep-ligne"><span class="pastille-ue" style="--c:${couleur(u)}">${h(u)}</span><input type="range" min="0" max="100" step="5" name="rep-${h(u)}" data-ue="${h(u)}" value="${val(u)}"><b id="rv-${h(u)}">${val(u)}</b></div>`).join("")}</div>
			<p class="petit" id="rep-total"></p>
			<div class="actions"><button type="button" class="bouton" data-fermer>Annuler</button><button class="bouton plein">Enregistrer</button></div>
		</form>`);
	const f = $("#f-rep");
	const maj = () => {
		const manuel = f.querySelector('[name="rep-mode"]:checked').value === "manuel";
		const tot = [...f.querySelectorAll("[data-ue]")].reduce((a, x) => a + Number(x.value), 0);
		f.querySelectorAll("[data-ue]").forEach((x) => { x.disabled = !manuel; $(`#rv-${CSS.escape(x.dataset.ue)}`).textContent = manuel && tot ? Math.round((100 * x.value) / tot) + " %" : Math.round(auto[x.dataset.ue] * 100) + " %"; });
		$("#rep-total").textContent = manuel ? "Les pourcentages sont recalculés pour faire 100 %." : "Calculé à partir de tes prochains partiels.";
	};
	f.addEventListener("input", maj); f.addEventListener("change", maj); maj();
	f.addEventListener("submit", (e) => {
		e.preventDefault();
		const mode = f.querySelector('[name="rep-mode"]:checked').value;
		const parts = Object.fromEntries([...f.querySelectorAll("[data-ue]")].map((x) => [x.dataset.ue, Number(x.value)]));
		fermerFeuille();
		action(() => modifier("config.json", "config", (c) => ({ ...c, repartition: { mode, parts } }), "Répartition des révisions", { sansSynchro: true }));
	});
}

function demarrerSession(type) {
	const now = auj();
	let liste = [], titre = "";
	const melanger = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
	const travail = (x) => RECALL.includes(x.it.type) || EXOS.includes(x.it.type);
	if (type === "dus") {
		titre = "À revoir";
		const dus = tousItems().filter((x) => travail(x) && estDu(x.k));
		liste = melanger(tirage(dus, Math.min(25, dus.length)));
	} else if (type === "comprendre") {
		titre = "Comprendre";
		liste = melanger(tirage(tousItems().filter((x) => estComprendre(x.it)), 15));
	} else if (type === "melange") {
		titre = "Session mélangée";
		liste = melanger(tirage(tousItems().filter(travail), 20));
	} else if (type.startsWith("partiel:")) {
		const [, pid, mode] = type.split(":");
		const p = trouverPartiel(pid);
		if (!p) return;
		const chs = chapitresPartiel(p);
		let l = chs.flatMap((ch) => (ch.items || []).map((it) => ({ ch, it, k: cle(ch.id, it.id) })));
		const boite = (x) => (S.data.progres[x.k] || {}).boite || 0;
		if (mode === "cartes") { titre = "Cartes · " + p.titre; l = melanger(l.filter((x) => RECALL.includes(x.it.type))).sort((a, b) => boite(a) - boite(b)).slice(0, 30); }
		else if (mode === "exos") { titre = "Exercices · " + p.titre; l = melanger(l.filter((x) => EXOS.includes(x.it.type))).slice(0, 20); }
		else if (mode === "blanc") { titre = "Test blanc · " + p.titre; l = melanger(l.filter((x) => ["qcm", "trous", "calcul"].includes(x.it.type))).slice(0, 15); }
		else { titre = p.titre; const cache = {}; l = l.filter(travail).sort((a, b) => scoreItem(a, cache) - scoreItem(b, cache) + (Math.random() - 0.5) * 2).slice(0, 25); l = melanger(l); }
		liste = l;
	} else if (type === "partiel") {
		const prochains = partielsTous().filter((p) => jourCle(p.debut) >= now && p.matiere);
		const ue = prochains.map((p) => p.matiere.split(" / ")[0]).find((u) => Object.values(R.chap).some((c) => c.ue === u));
		if (!ue) { alerteDouce("Aucun chapitre lié à tes prochains partiels pour l'instant."); return; }
		titre = `Partiel ${ue}`;
		liste = melanger(tousItems().filter((x) => x.ch.ue === ue && travail(x))).slice(0, 20);
	} else {
		const [mode, id] = type.split(":");
		const ch = R.chap[id];
		titre = mode === "cartes" ? "Cartes" : mode === "exos" ? "Exercices" : ch.titre;
		liste = (ch.items || []).map((it) => ({ ch, it, k: cle(ch.id, it.id) })).filter((x) => (mode === "cartes" ? RECALL.includes(x.it.type) : mode === "exos" ? EXOS.includes(x.it.type) : x.it.type !== "fiche"));
		if (mode === "cartes") liste = melanger(liste);
	}
	if (!liste.length) { alerteDouce("Rien à réviser ici pour l'instant."); return; }
	R.session = { titre, cles: liste.map((x) => x.k), i: 0, bons: 0, repondu: false };
	location.hash = "#reviser";
	rendre();
	window.scrollTo(0, 0);
}
function repondu(k, niveau) {
	noter(k, niveau);
	montrerAide(k);
	if (R.session && R.session.cles[R.session.i] === k) {
		R.session.repondu = true;
		if (niveau > 0) R.session.bons++;
		const b = document.querySelector("[data-r-suivant]");
		if (b) { b.classList.add("plein"); b.textContent = "Suivant ›"; }
	}
}

// ---------- Correction immédiate ----------
R.notes = {}; // éléments déjà notés pendant cet affichage
function corrigerTrou(c) {
	const k = c.dataset.rTrouDe;
	if (!c.value.trim()) { c.classList.remove("bon", "faux"); return; }
	const ok = c.dataset.rep.split("|").some((r) => proche(norm(r), norm(c.value)));
	c.classList.toggle("bon", ok); c.classList.toggle("faux", !ok);
	const champs = [...c.closest(".r-trous").querySelectorAll(".r-trou")];
	const remplis = champs.filter((x) => x.value.trim());
	const bons = champs.filter((x) => x.classList.contains("bon")).length;
	const zone = $(`#r-${CSS.escape(k)}`);
	if (remplis.length === champs.length) {
		zone.innerHTML = `<div class="r-msg ${bons === champs.length ? "ok" : "ko"}">${bons === champs.length ? "✓ Tout est juste !" : `${bons}/${champs.length} correct${bons > 1 ? "s" : ""} — corrige les cases en rouge`}</div>`;
		if (!R.notes[k]) { R.notes[k] = 1; repondu(k, bons === champs.length ? 1 : 0); }
	}
	return ok;
}
function corrigerCalcul(k) {
	const x = item(k); if (!x?.it) return;
	const it = x.it, champ = $(`#c-${CSS.escape(k)}`), zone = $(`#r-${CSS.escape(k)}`);
	if (!champ.value.trim()) { zone.innerHTML = ""; return; }
	const v = nombre(champ.value), att = Number(it.reponse.valeur), tol = it.reponse.tolerance ?? 0.02;
	if (v == null) { zone.innerHTML = `<div class="r-msg ko">Entre un nombre.</div>`; return; }
	const ok = att === 0 ? Math.abs(v) < 1e-9 : Math.abs(v - att) / Math.abs(att) <= tol;
	champ.classList.toggle("bon", ok); champ.classList.toggle("faux", !ok);
	zone.innerHTML = `<div class="r-msg ${ok ? "ok" : "ko"}">${ok ? "✓ Juste !" : "✗ Pas tout à fait. Essaie un indice, ou ouvre la solution."}</div>`;
	if (!R.notes[k]) { R.notes[k] = 1; repondu(k, ok ? 1 : 0); }
}
// Trous : vert dès que le mot est juste, puis case suivante ; vérification à la sortie de chaque case
document.addEventListener("input", (e) => {
	const c = e.target;
	if (!c.classList?.contains("r-trou")) return;
	c.classList.remove("faux");
	const alts = c.dataset.rep.split("|").map(norm), v = norm(c.value);
	// avance seulement si le mot est complet (pas le début d'une variante plus longue, ex. « plane » / « planes »)
	if (alts.includes(v) && !alts.some((a) => a.length > v.length && a.startsWith(v))) {
		corrigerTrou(c);
		const champs = [...c.closest(".r-trous").querySelectorAll(".r-trou")];
		const suivant = champs.slice(champs.indexOf(c) + 1).find((x) => !x.classList.contains("bon"));
		if (suivant) suivant.focus();
	}
});
document.addEventListener("change", (e) => {
	if (e.target.classList?.contains("r-trou")) corrigerTrou(e.target);
	if (e.target.dataset?.rCalc) corrigerCalcul(e.target.dataset.rCalc);
});
document.addEventListener("keydown", (e) => {
	if (e.key !== "Enter") return;
	if (e.target.dataset?.rCalc) { e.preventDefault(); corrigerCalcul(e.target.dataset.rCalc); e.target.blur(); }
	if (e.target.classList?.contains("r-trou")) { e.preventDefault(); corrigerTrou(e.target); const ch = [...e.target.closest(".r-trous").querySelectorAll(".r-trou")]; (ch[ch.indexOf(e.target) + 1] || e.target).focus(); }
});

// ---------- Évènements ----------
document.addEventListener("click", (e) => {
	const el = e.target.closest("[data-r-ouvrir],[data-r-retour],[data-r-session],[data-r-prochain-partiel],[data-r-modif-partiel],[data-r-repartition],[data-r-fin],[data-r-suivant],[data-r-montrer],[data-r-note],[data-r-qcm],[data-r-trous],[data-r-calcul],[data-r-solution],[data-r-indice],[data-r-comparer],[data-r-envoyer],[data-r-claude-txt],[data-r-chrono]");
	if (!el) return;
	const d = el.dataset;
	if (d.rOuvrir) { R.ouvert = d.rOuvrir; R.session = null; location.hash = "#reviser"; rendre(); window.scrollTo(0, 0); return; }
	if ("rRetour" in d) { if (R.ouvert) R.ouvert = null; else R.partiel = null; rendre(); window.scrollTo(0, 0); return; }
	if (d.rSession) return demarrerSession(d.rSession);
	if ("rRepartition" in d) return feuilleRepartition();
	if ("rProchainPartiel" in d) { const p = partielsTous().find((x) => jourCle(x.debut) >= auj()); if (!p) { alerteDouce("Aucun partiel à venir."); return; } R.partiel = p.id; rendre(); window.scrollTo(0, 0); return; }
	if (d.rModifPartiel) {
		const p = trouverPartiel(d.rModifPartiel);
		if (!p) return;
		if (p.source === "Lise") formPartiel({ liseUid: p.liseUid, surchargeId: p.surchargeId, titre: p.titre, matiere: p.matiere, description: p.description, chapitres: p.chapitres });
		else formPartiel(S.data.partiels.find((x) => x.id === p.id));
		return;
	}
	if ("rFin" in d) { R.session = null; rendre(); window.scrollTo(0, 0); return; }
	if ("rSuivant" in d) { R.session.i++; R.session.repondu = false; rendre(); window.scrollTo(0, 0); return; }
	const k = d.rMontrer || d.rNote || d.rQcm || d.rTrous || d.rCalcul || d.rSolution || d.rIndice || d.rComparer || d.rEnvoyer || d.rClaudeTxt || d.rChrono;
	const x = item(k);
	if (!x?.it) return;
	const { ch, it } = x;
	if (d.rMontrer) {
		$(`#v-${CSS.escape(k)}`).hidden = false; el.hidden = true;
		montrerAide(k);
		const n = $(`#n-${CSS.escape(k)}`); if (n) n.hidden = false;
		formules($(`#v-${CSS.escape(k)}`));
		return;
	}
	if (d.rNote) {
		repondu(k, Number(d.n));
		const n = $(`#n-${CSS.escape(k)}`); if (n) n.innerHTML = `<span class="petit">✓ Noté — ${["revient demain", "revient plus tard", "revient bien plus tard"][Number(d.n)]}</span>`;
		return;
	}
	if (d.rQcm) {
		const i = Number(d.i), bon = i === it.bonne;
		el.parentElement.querySelectorAll("button").forEach((b) => { const j = Number(b.dataset.i); b.disabled = true; if (j === it.bonne) b.classList.add("bon"); else if (j === i) b.classList.add("faux"); });
		$(`#r-${CSS.escape(k)}`).innerHTML = `<div class="r-msg ${bon ? "ok" : "ko"}">${bon ? "✓ Bonne réponse" : "✗ Ce n'est pas ça"}</div>${it.explication ? `<div class="r-md">${md(it.explication)}</div>` : ""}`;
		formules($(`#r-${CSS.escape(k)}`));
		repondu(k, bon ? 1 : 0);
		return;
	}
	if (d.rSolution && it.type === "trous") {
		const champs = [...$(`#t-${CSS.escape(k)}`).querySelectorAll(".r-trou")];
		champs.forEach((c) => { if (!c.classList.contains("bon")) { c.value = c.dataset.rep.split("|")[0]; c.classList.remove("faux"); c.classList.add("montre"); } });
		if (!R.notes[k]) { R.notes[k] = 1; repondu(k, 0); }
		montrerAide(k);
		return;
	}
	if (d.rSolution) { const s = $(`#s-${CSS.escape(k)}`); s.hidden = !s.hidden; formules(s); montrerAide(k); return; }
	if (d.rIndice) {
		const box = $(`#ind-${CSS.escape(k)}`);
		const n = box.children.length;
		if (n < it.indices.length) { box.insertAdjacentHTML("beforeend", `<div class="r-indice">💡 ${md(it.indices[n])}</div>`); formules(box); }
		if (n + 1 >= it.indices.length) { el.disabled = true; el.textContent = "Plus d'indice"; }
		return;
	}
	if (d.rComparer) {
		const v = $(`#v-${CSS.escape(k)}`);
		v.hidden = false;
		v.innerHTML = `<div class="section-titre" style="margin-top:12px">Points clés attendus — coche ceux que tu as mis</div>
			${(it.attendus || []).map((a, i) => `<label class="choix"><input type="checkbox" data-r-att="${h(k)}" value="${i}"><span>${inline(h(a))}</span></label>`).join("")}
			${it.modele ? `<details style="margin-top:10px"><summary class="petit">Voir une réponse modèle</summary><div class="r-md">${md(it.modele)}</div></details>` : ""}
			<button class="bouton plein large" style="margin-top:10px" data-r-score="${h(k)}">Enregistrer mon score</button>`;
		formules(v);
		return;
	}
	if (d.rEnvoyer) {
		const texte = ($(`#x-${CSS.escape(k)}`)?.value || "").trim();
		const photo = R.photos[k];
		if (texte.length < 20 && !photo) { alerteDouce("Écris un peu plus ou joins une photo avant d'envoyer."); return; }
		const r = { id: uid(), cle: k, type: it.type, texte, date: new Date().toISOString(), statut: "en_attente" };
		el.disabled = true; el.textContent = "Envoi…";
		(async () => {
			if (photo) { r.image = `revision/rendus/${r.id}.jpg`; await envoyerImage(r.image, photo, `Photo de rendu : ${ch.titre}`); }
			await modifier("revision/rendus.json", "rendus", (l) => [...l, r], `Rendu : ${TYPES[it.type]} · ${ch.titre}`, { sansSynchro: true, cible: "revision" });
		})()
			.then(() => {
				delete R.photos[k];
				const ap = $(`#p-${CSS.escape(k)}`); if (ap) ap.innerHTML = "";
				const carte = el.closest(".r-carte");
				carte.querySelectorAll(".r-statut").forEach((x) => x.remove());
				el.closest(".r-actions").insertAdjacentHTML("afterend", `<div class="r-statut en_attente">⏳ Envoyé${r.image ? " avec photo" : ""} · correction cette nuit</div>`);
				el.textContent = "Envoyé ✓";
			})
			.catch((err) => { el.disabled = false; el.textContent = "Réessayer"; alerteDouce(err.message); });
		return;
	}
	if (d.rClaudeTxt) {
		e.preventDefault();
		const texte = $(`#x-${CSS.escape(k)}`).value.trim();
		window.open(lienClaude(ch, it, texte), "_blank", "noopener");
		return;
	}
	if (d.rChrono) {
		clearInterval(R.chrono);
		let reste = 300;
		const aff = $(`#ch-${CSS.escape(k)}`);
		R.chrono = setInterval(() => { reste--; if (aff) aff.textContent = `${Math.floor(reste / 60)}:${String(reste % 60).padStart(2, "0")}`; if (reste <= 0) { clearInterval(R.chrono); if (aff) aff.textContent = "⏰ Temps écoulé : compare !"; } }, 1000);
		return;
	}
});
document.addEventListener("change", async (e) => {
	const k = e.target.dataset?.rPhoto;
	if (!k || !e.target.files?.[0]) return;
	try {
		R.photos[k] = await compresserImage(e.target.files[0]);
		const ap = $(`#p-${CSS.escape(k)}`);
		if (ap) ap.innerHTML = `<img src="${R.photos[k]}" alt="Photo jointe"><button class="bouton petit-b" data-r-photo-suppr="${h(k)}">Retirer</button>`;
	} catch { alerteDouce("Impossible de lire cette image."); }
});
document.addEventListener("click", (e) => {
	const b = e.target.closest("[data-r-photo-suppr]");
	if (!b) return;
	delete R.photos[b.dataset.rPhotoSuppr];
	b.parentElement.innerHTML = "";
});
// Dictée, vérification au clavier numérique (pas de touche « Entrée » sur iOS), banque de mots
document.addEventListener("click", (e) => {
	const b = e.target.closest("[data-r-dicter]");
	if (b) dicter(b.dataset.rDicter, b);
});
document.addEventListener("click", (e) => {
	const b = e.target.closest("[data-r-verifier]");
	if (b) corrigerCalcul(b.dataset.rVerifier);
});
document.addEventListener("click", (e) => {
	const b = e.target.closest("[data-r-banque]");
	if (!b) return;
	const box = $(`#b-${CSS.escape(b.dataset.rBanque)}`);
	if (box) box.hidden = !box.hidden;
});
document.addEventListener("click", (e) => {
	const chip = e.target.closest("[data-r-chip]");
	if (!chip || chip.disabled) return;
	const champs = [...document.querySelectorAll(`#t-${CSS.escape(chip.dataset.rChip)} .r-trou`)];
	const actif = document.activeElement;
	const cible = champs.includes(actif) && !actif.classList.contains("bon") ? actif : champs.find((c) => !c.classList.contains("bon"));
	if (!cible) return;
	cible.value = chip.dataset.mot;
	cible.dispatchEvent(new Event("input", { bubbles: true }));
	if (!cible.classList.contains("bon")) corrigerTrou(cible);
	if (cible.classList.contains("bon")) chip.disabled = true;
});
document.addEventListener("click", (e) => {
	const b = e.target.closest("[data-r-score]");
	if (!b) return;
	const k = b.dataset.rScore;
	const cases = [...document.querySelectorAll(`[data-r-att="${CSS.escape(k)}"]`)];
	const n = cases.filter((c) => c.checked).length, tot = cases.length || 1;
	repondu(k, n / tot >= 0.9 ? 2 : n / tot >= 0.6 ? 1 : 0);
	b.outerHTML = `<div class="r-msg ${n / tot >= 0.6 ? "ok" : "ko"}">${n}/${tot} points clés · ${n / tot >= 0.6 ? "bien joué" : "à retravailler, ça reviendra bientôt"}</div>`;
});
document.addEventListener("click", (e) => {
	const t = e.target.closest("[data-r-touche]");
	if (t) {
		const c = document.getElementById(t.dataset.rTouche);
		if (!c) return;
		if (t.dataset.t === "-") c.value = /e$/i.test(c.value) ? c.value + "-" : c.value.startsWith("-") ? c.value.slice(1) : "-" + c.value;
		else if (!/e/i.test(c.value)) c.value += "e";
		c.focus();
		return;
	}
	const v = e.target.closest("[data-r-etape-v]");
	if (v) { corrigerEtape(v.dataset.rEtapeV, Number(v.dataset.i)); return; }
	const ind = e.target.closest("[data-r-etape-ind]");
	if (ind) {
		const x = item(ind.dataset.rEtapeInd), et = x?.it.etapes[Number(ind.dataset.i)];
		if (et) { const z = ind.parentElement; z.innerHTML = `💡 ${inline(h(et.indice))}`; formules(z); }
	}
});
document.addEventListener("keydown", (e) => {
	if (e.key !== "Enter" || !e.target.dataset?.rEtape) return;
	e.preventDefault(); corrigerEtape(e.target.dataset.rEtape, Number(e.target.dataset.i));
});
let brouillonTimer;
document.addEventListener("input", (e) => {
	const k = e.target.dataset?.rBrouillon;
	if (!k) return;
	R.brouillons[k] = e.target.value;
	clearTimeout(brouillonTimer);
	brouillonTimer = setTimeout(() => store.set("ae.brouillons", R.brouillons), 500);
});
