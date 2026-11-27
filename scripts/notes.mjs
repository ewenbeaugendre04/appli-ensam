// Récupère les notes de Lise (page « Mes notes ») → notes.json dans le dépôt PRIVÉ.
// Même méthode que Better Lise : connexion par /login (identifiant + mot de passe Lise), puis navigation JSF.
// Le mot de passe vient du secret GitHub LISE_PASSWORD ; il n'est jamais écrit nulle part.
// Aucune dépendance externe. Node 20+.
import { readFile } from "node:fs/promises";

const LISE = "https://lise.ensam.eu";
const TOKEN = process.env.DATA_TOKEN;
const DATA_REPO = process.env.DATA_REPO || "ewenbeaugendre04/appli-ensam-data";
let USER = process.env.LISE_USER; // sinon : liseId de config.json
const PASS = process.env.LISE_PASSWORD;
const LOCAL_HTML = process.env.LOCAL_HTML; // tests : page de notes enregistrée
// Mode « camarade » : GROUPE=<id> → seulement l'emploi du temps du site (jamais ses notes), rangé dans groupes/<id>/
const GROUPE = process.env.GROUPE || "";
const DOSSIER = GROUPE ? `groupes/${GROUPE}/` : "";
const MENU_NOTES = { submenuId: process.env.LISE_SUBMENU || "submenu_47356", buttonId: process.env.LISE_BUTTON || "5_0" };
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

// ---------- Dépôt privé ----------
async function gh(path, opts = {}) {
	return fetch(`https://api.github.com/repos/${DATA_REPO}/contents/${path}`, {
		...opts, headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(opts.headers || {}) },
	});
}
async function lireNotes() {
	const r = await gh("notes.json");
	if (r.status === 404) return { data: { notes: [] }, sha: null };
	if (!r.ok) throw new Error(`Lecture notes.json : ${r.status}`);
	const j = await r.json();
	return { data: JSON.parse(Buffer.from(j.content, "base64").toString("utf8")), sha: j.sha };
}
async function ecrireNotes(data, sha, message) {
	const body = { message, content: Buffer.from(JSON.stringify(data, null, 2) + "\n").toString("base64"), committer: { name: "Appli ENSAM", email: "appli-ensam@users.noreply.github.com" } };
	if (sha) body.sha = sha;
	const r = await gh("notes.json", { method: "PUT", body: JSON.stringify(body) });
	if (!r.ok) throw new Error(`Écriture notes.json : ${r.status}`);
}

// ---------- Cookies ----------
const jar = new Map();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
function retenir(res) {
	for (const c of res.headers.getSetCookie?.() || []) {
		const [kv] = c.split(";"); const i = kv.indexOf("=");
		if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
	}
}
async function requete(url, opts = {}, sauts = 6) {
	const res = await fetch(url, { ...opts, redirect: "manual", signal: AbortSignal.timeout(25000), headers: { "User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9", Cookie: cookieHeader(), ...(opts.headers || {}) } });
	retenir(res);
	const loc = res.headers.get("location");
	if (res.status >= 300 && res.status < 400 && loc && sauts > 0 && !opts.pasDeSuivi) return requete(new URL(loc, url).href, { headers: opts.headers }, sauts - 1);
	return res;
}

// ---------- Analyse HTML (sans bibliothèque) ----------
const ENT = { eacute: "é", egrave: "è", ecirc: "ê", euml: "ë", agrave: "à", acirc: "â", ccedil: "ç", icirc: "î", iuml: "ï", ocirc: "ô", ugrave: "ù", ucirc: "û", Eacute: "É", Egrave: "È", Agrave: "À", Ccedil: "Ç", oelig: "œ", rsquo: "’", laquo: "«", raquo: "»", deg: "°" };
const decoder = (s) => s.replace(/&([a-zA-Z]+);/g, (m, n) => ENT[n] ?? m).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&#039;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const texte = (html) => decoder(html.replace(/<span[^>]*ui-column-title[^>]*>.*?<\/span>/gis, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
function champCache(html, nom) {
	const re = new RegExp(`<input[^>]*name="${nom.replace(/[.:]/g, "\\$&")}"[^>]*>`, "i");
	const tag = html.match(re)?.[0];
	return tag ? decoder(tag.match(/value="([^"]*)"/i)?.[1] ?? "") : null;
}
export function analyserNotes(html) {
	const corps = html.match(/<tbody[^>]*id="form:dataTableFavori_data"[^>]*>([\s\S]*?)<\/tbody>/i)?.[1];
	if (corps == null) return null;
	const notes = [];
	for (const tr of corps.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
		const td = (tr.match(/<td[\s\S]*?<\/td>/gi) || []).map(texte);
		const [date, code, libelle, brut, absence, commentaire, enseignants] = td;
		if (!date || !code || !libelle) continue;
		const note = parseFloat(String(brut).replace(",", "."));
		notes.push({ date, code, libelle, note: isNaN(note) ? null : note, brut: brut || "", absence: absence || "", commentaire: commentaire || "", enseignants: enseignants || "" });
	}
	return notes;
}
// Fiche d'un cours (fenêtre ouverte au clic dans l'agenda) : nombre d'apprenants, code du cours, statut, matière
export function analyserFiche(xml) {
	const cd = [...xml.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)].map((m) => m[1]).join("\n");
	const t = texte(cd);
	const nb = t.match(/Apprenants\s*\((\d+)\)/i)?.[1];
	return {
		apprenants: nb ? Number(nb) : null,
		code: t.match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+){3,}\b/)?.[0] || "",
		statut: t.match(/Statut\s+(.+?)\s+Mati[èe]re/i)?.[1] || "",
		matiere: t.match(/Mati[èe]re\s+(.+?)\s+Type d'enseignement/i)?.[1] || "",
	};
}

// ---------- Navigation Lise ----------
const FORM = (idInit) => ({ form: "form", "form:largeurDivCenter": "1279", "form:idInit": idInit, "form:sauvegarde": "", "form:j_idt849:j_idt852_view": "basicDay", "form:j_idt814:j_idt816_dropdown": "1", "form:j_idt814:j_idt816_mobiledropdown": "1", "form:j_idt814:j_idt816_page": "0" });
const post = (body, ajax) => requete(`${LISE}/faces/MainMenuPage.xhtml`, {
	method: "POST", body: new URLSearchParams(body).toString(),
	headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Origin: LISE, Referer: `${LISE}/`, ...(ajax ? { "Faces-Request": "partial/ajax", "X-Requested-With": "XMLHttpRequest", Accept: "application/xml, text/xml, */*; q=0.01" } : { Accept: "text/html,application/xhtml+xml,*/*;q=0.8" }) },
});
// Planning du site (plus à jour que le lien iCal) : l'agenda de la page d'accueil est chargé
// pour 1 semaine en arrière et 6 semaines en avant ; la réponse brute est gardée dans le dépôt privé.
const JOUR = 86400e3;
const PLAN_DEBUT = Math.floor((Date.now() - 7 * JOUR) / JOUR) * JOUR;
const PLAN_FIN = PLAN_DEBUT + 49 * JOUR;
let planningBrut = null;
let ctxAgenda = null; // { schedId, idInit, vs } : pour interroger la fiche d'un cours
async function lireFichier(path) {
	const r = await gh(path);
	if (!r.ok) return { data: null, sha: null };
	const j = await r.json();
	return { data: JSON.parse(Buffer.from(j.content, "base64").toString("utf8")), sha: j.sha };
}
async function ecrireFichier(path, objet, message) {
	const r = await gh(path);
	const sha = r.ok ? (await r.json()).sha : null;
	const body = { message, content: Buffer.from(JSON.stringify(objet, null, 2) + "\n").toString("base64"), committer: { name: "Appli ENSAM", email: "appli-ensam@users.noreply.github.com" } };
	if (sha) body.sha = sha;
	return gh(path, { method: "PUT", body: JSON.stringify(body) });
}
async function ecrirePlanningBrut() {
	if (!planningBrut || !TOKEN) return;
	// On réécrit si le planning a changé, sinon au plus toutes les 6 h (la synchro le juge périmé après 24 h)
	const ancien = (await lireFichier(DOSSIER + "planning-web.json")).data;
	const pareil = ancien && JSON.stringify(ancien.events) === JSON.stringify(planningBrut);
	if (pareil && Date.now() - Date.parse(ancien.majLe) < 6 * 3600e3) { console.log(`Planning du site ${DOSSIER}inchangé (${planningBrut.length} cours).`); return; }
	const w = await ecrireFichier(DOSSIER + "planning-web.json", { majLe: new Date().toISOString(), debut: PLAN_DEBUT, fin: PLAN_FIN, events: planningBrut }, `Planning Lise (site) ${DOSSIER}: ${pareil ? "vérification" : "mis à jour"}`);
	console.log(`Planning du site ${DOSSIER}: ${planningBrut.length} cours, écriture ${w.status}`);
}
// Fiches des cours concernés par un écart (comme un clic dans l'agenda) : code du cours et nombre d'apprenants.
// Résultat : planning-details.json ; les deux premières réponses brutes sont gardées dans planning-detail-debug.json.
async function recupererDetails() {
	if (!ctxAgenda || !planningBrut || !TOKEN) return;
	const cibles = [];
	const ajouter = (w) => { if (w && w.id != null && !cibles.includes(w)) cibles.push(w); };
	try {
		const ec = (await lireFichier("ecarts.json")).data?.ecarts || [];
		for (const x of ec) {
			if (!x.apres) continue;
			ajouter(planningBrut.find((e) => new Date(e.start).toISOString() === x.apres.debut && (!x.apres.module || e.title.includes(x.apres.module))));
		}
	} catch (err) { console.error("Lecture des écarts :", err.message); }
	ajouter(planningBrut.find((e) => /Réaliser Produit/.test(e.title)));
	if (!cibles.length) { await ecrireFichier("planning-detail-debug.json", { majLe: new Date().toISOString(), note: "aucun cours avec identifiant", premierCours: planningBrut[0] }, "Planning Lise : sonde (aucun identifiant)"); return; }
	const { schedId, idInit, vs } = ctxAgenda;
	const details = [], bruts = [];
	for (const e of cibles.slice(0, 20)) {
		try {
			const r = await post({ "javax.faces.partial.ajax": "true", "javax.faces.source": schedId, "javax.faces.partial.execute": schedId, "javax.faces.behavior.event": "eventSelect", "javax.faces.partial.event": "eventSelect", [schedId + "_selectedEventId"]: String(e.id), ...FORM(idInit), "form:largeurDivCenter": "", "javax.faces.ViewState": vs }, true);
			const xml = await r.text();
			const f = analyserFiche(xml);
			details.push({ start: e.start, title: e.title, id: e.id, ...f });
			if (bruts.length < 2) bruts.push({ title: e.title, start: e.start, champs: Object.keys(e), statut: r.status, reponse: xml.slice(0, 30000) });
		} catch (err) { details.push({ start: e.start, title: e.title, id: e.id, erreur: String(err.message || err) }); }
		await new Promise((ok) => setTimeout(ok, 1500));
	}
	const ancien = (await lireFichier("planning-details.json")).data?.details || [];
	const cle = (d) => `${d.start}|${d.title}`;
	const fusion = new Map(ancien.map((d) => [cle(d), d]));
	for (const d of details) if (!d.erreur && (d.code || d.apprenants != null)) fusion.set(cle(d), d);
	await ecrireFichier("planning-details.json", { majLe: new Date().toISOString(), details: [...fusion.values()] }, `Fiches Lise : ${details.filter((d) => d.code || d.apprenants != null).length}/${details.length} lues`);
	await ecrireFichier("planning-detail-debug.json", { majLe: new Date().toISOString(), premierCours: planningBrut[0], resultats: bruts, extraits: details }, "Planning Lise : sonde de la fiche d'un cours");
	console.log(`Fiches des cours : ${details.length} demandées.`);
}

async function pageNotes(avecNotes = true) {
	const login = await requete(`${LISE}/login`, { method: "POST", pasDeSuivi: true, body: new URLSearchParams({ username: USER, password: PASS, j_idt28: "" }).toString(), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
	if (login.status !== 302 || !jar.has("JSESSIONID")) throw new Error(`Connexion Lise refusée (${login.status}) : vérifie l'identifiant et le mot de passe`);
	const accueil = await (await requete(LISE)).text();
	if (/Connectez-vous|Sign in/i.test(accueil.match(/<title>(.*?)<\/title>/is)?.[1] || "")) throw new Error("Session Lise non ouverte");
	const vs = champCache(accueil, "javax.faces.ViewState"), idInit = champCache(accueil, "form:idInit");
	if (!vs || !idInit) throw new Error("Page d'accueil Lise inattendue (champs cachés absents)");
	const schedId = accueil.match(/PrimeFaces\.cw\("Schedule","[^"]+",\{id:"([^"]+)"/)?.[1] || "form:j_idt849:j_idt852";
	const r1 = await (await post({ "javax.faces.partial.ajax": "true", "javax.faces.source": schedId, "javax.faces.partial.execute": schedId, "javax.faces.partial.render": schedId, [schedId]: schedId, [schedId + "_start"]: String(PLAN_DEBUT), [schedId + "_end"]: String(PLAN_FIN), ...FORM(idInit), "form:largeurDivCenter": "", "javax.faces.ViewState": vs }, true)).text();
	const cdata = r1.match(/<!\[CDATA\[([\s\S]*?)\]\]><\/update>/)?.[1];
	// On garde tous les champs renvoyés par Lise pour chaque cours (identifiant, données étendues…), pas seulement titre et horaires
	try { const evs = JSON.parse(cdata).events; if (Array.isArray(evs) && evs.length) planningBrut = evs.map((e) => ({ ...e, type: e.className })); } catch { /* format inattendu : on garde le lien iCal */ }
	const vs2 = decoder(r1.match(/<update id="j_id1:javax\.faces\.ViewState:0"><!\[CDATA\[([\s\S]*?)\]\]><\/update>/)?.[1] || r1.match(/<update id="j_id1:javax\.faces\.ViewState:0">([\s\S]*?)<\/update>/)?.[1] || vs);
	ctxAgenda = { schedId, idInit, vs: vs2 };
	if (!avecNotes) return null;
	await post({ "javax.faces.partial.ajax": "true", "javax.faces.source": "form:j_idt52", "javax.faces.partial.execute": "form:j_idt52", "javax.faces.partial.render": "form:sidebar", "form:j_idt52": "form:j_idt52", "webscolaapp.Sidebar.ID_SUBMENU": MENU_NOTES.submenuId, ...FORM(idInit), "javax.faces.ViewState": vs2 }, true);
	return (await post({ ...FORM(idInit), "javax.faces.ViewState": vs2, "form:sidebar": "form:sidebar", "form:sidebar_menuid": MENU_NOTES.buttonId }, false)).text();
}

// ---------- Mode camarade : emploi du temps du site seulement ----------
async function mainGroupe() {
	const etatFichier = DOSSIER + "etat-site.json";
	const noter = async (ok, message) => { if (TOKEN) { const a = (await lireFichier(etatFichier)).data; if (a?.message !== message || a?.ok !== ok) await ecrireFichier(etatFichier, { ok, message, le: new Date().toISOString() }, `Planning ${DOSSIER}: ${ok ? "ok" : "échec"}`); } };
	const config = JSON.parse(Buffer.from((await (await gh("config.json")).json()).content, "base64").toString("utf8"));
	const g = (config.groupes || []).find((x) => x.id === GROUPE);
	if (!g?.liseId) { console.log(`Groupe ${GROUPE} non configuré.`); return; }
	if (!PASS) { console.log(`Pas de mot de passe pour ${GROUPE} : seul le lien iCal sera utilisé.`); await noter(false, "Mot de passe Lise du camarade absent : seul le lien iCal (numéro étudiant) est utilisé."); return; }
	USER = g.liseId;
	try {
		await pageNotes(false);
		if (!planningBrut) throw new Error("emploi du temps du site illisible");
		await ecrirePlanningBrut();
		await noter(true, `Site Lise lu (${planningBrut.length} créneaux).`);
	} catch (e) { console.log(`::warning title=Planning ${GROUPE}::${e.message}`); await noter(false, e.message); }
}

// ---------- Programme ----------
async function main() {
	if (GROUPE) return mainGroupe();
	if (!LOCAL_HTML && !PASS) {
		console.log("Pas de secret LISE_PASSWORD : notes non synchronisées.");
		// On le signale dans l'appli pour que ce soit visible
		if (TOKEN) {
			const { data, sha } = await lireNotes();
			const message = "Le secret LISE_PASSWORD est introuvable dans le dépôt appli-ensam (Settings → Secrets and variables → Actions → onglet Secrets → Repository secrets).";
			if (data.etat?.message !== message) await ecrireNotes({ ...data, etat: { ok: false, message }, essaiLe: new Date().toISOString() }, sha, "Notes : secret absent");
		}
		return;
	}
	if (!LOCAL_HTML && !TOKEN) throw new Error("Secret DATA_TOKEN manquant");
	if (!USER && !LOCAL_HTML) {
		const r = await gh("config.json");
		if (r.ok) USER = JSON.parse(Buffer.from((await r.json()).content, "base64").toString("utf8")).liseId;
		if (!USER) throw new Error("Identifiant Lise introuvable (config.json → liseId)");
	}
	const maintenant = new Date().toISOString();
	let notes, etat = { ok: true, message: "" };
	try {
		const html = LOCAL_HTML ? await readFile(LOCAL_HTML, "utf8") : await pageNotes();
		notes = analyserNotes(html);
		if (notes == null) throw new Error("Tableau des notes introuvable (Lise a peut-être changé son menu)");
	} catch (e) { etat = { ok: false, message: e.message }; console.error("Notes :", e.message); }
	if (LOCAL_HTML) { console.log(JSON.stringify({ etat, notes }, null, 2)); return; }
	try { await ecrirePlanningBrut(); } catch (e) { console.error("Planning :", e.message); }
	try { await recupererDetails(); } catch (e) { console.error("Fiches :", e.message); }
	const { data: ancien, sha } = await lireNotes();
	if (!etat.ok) {
		// On garde les anciennes notes et on signale juste l'échec
		if (ancien.etat?.message !== etat.message) await ecrireNotes({ ...ancien, etat, essaiLe: maintenant }, sha, "Notes : échec de synchro");
		process.exitCode = 1; return;
	}
	const avant = new Map((ancien.notes || []).map((n) => [n.code, n]));
	const fusion = notes.map((n) => { const a = avant.get(n.code); return { ...n, ajouteLe: a && a.brut === n.brut ? a.ajouteLe : maintenant }; });
	const change = JSON.stringify(fusion.map(({ ajouteLe, ...n }) => n)) !== JSON.stringify((ancien.notes || []).map(({ ajouteLe, ...n }) => n));
	if (change || !ancien.etat?.ok) {
		await ecrireNotes({ majLe: maintenant, etat, notes: fusion }, sha, `Notes : ${fusion.length} notes`);
		console.log(`Notes mises à jour (${fusion.length}).`);
	} else console.log("Notes inchangées.");
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exitCode = 1; });
