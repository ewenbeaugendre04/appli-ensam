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
	const res = await fetch(url, { ...opts, redirect: "manual", headers: { "User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9", Cookie: cookieHeader(), ...(opts.headers || {}) } });
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

// ---------- Navigation Lise ----------
const FORM = (idInit) => ({ form: "form", "form:largeurDivCenter": "1279", "form:idInit": idInit, "form:sauvegarde": "", "form:j_idt849:j_idt852_view": "basicDay", "form:j_idt814:j_idt816_dropdown": "1", "form:j_idt814:j_idt816_mobiledropdown": "1", "form:j_idt814:j_idt816_page": "0" });
const post = (body, ajax) => requete(`${LISE}/faces/MainMenuPage.xhtml`, {
	method: "POST", body: new URLSearchParams(body).toString(),
	headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Origin: LISE, Referer: `${LISE}/`, ...(ajax ? { "Faces-Request": "partial/ajax", "X-Requested-With": "XMLHttpRequest", Accept: "application/xml, text/xml, */*; q=0.01" } : { Accept: "text/html,application/xhtml+xml,*/*;q=0.8" }) },
});
async function pageNotes() {
	const login = await requete(`${LISE}/login`, { method: "POST", pasDeSuivi: true, body: new URLSearchParams({ username: USER, password: PASS, j_idt28: "" }).toString(), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
	if (login.status !== 302 || !jar.has("JSESSIONID")) throw new Error(`Connexion Lise refusée (${login.status}) : vérifie l'identifiant et le mot de passe`);
	const accueil = await (await requete(LISE)).text();
	if (/Connectez-vous|Sign in/i.test(accueil.match(/<title>(.*?)<\/title>/is)?.[1] || "")) throw new Error("Session Lise non ouverte");
	const vs = champCache(accueil, "javax.faces.ViewState"), idInit = champCache(accueil, "form:idInit");
	if (!vs || !idInit) throw new Error("Page d'accueil Lise inattendue (champs cachés absents)");
	const r1 = await (await post({ "javax.faces.partial.ajax": "true", "javax.faces.source": "form:j_idt849:j_idt852", "javax.faces.partial.execute": "form:j_idt849:j_idt852", "javax.faces.partial.render": "form:j_idt849:j_idt852", "form:j_idt849:j_idt852": "form:j_idt849:j_idt852", "form:j_idt849:j_idt852_start": "1761519600000", "form:j_idt849:j_idt852_end": "1761606000000", ...FORM(idInit), "form:largeurDivCenter": "", "javax.faces.ViewState": vs }, true)).text();
	const vs2 = decoder(r1.match(/<update id="j_id1:javax\.faces\.ViewState:0"><!\[CDATA\[([\s\S]*?)\]\]><\/update>/)?.[1] || r1.match(/<update id="j_id1:javax\.faces\.ViewState:0">([\s\S]*?)<\/update>/)?.[1] || vs);
	await post({ "javax.faces.partial.ajax": "true", "javax.faces.source": "form:j_idt52", "javax.faces.partial.execute": "form:j_idt52", "javax.faces.partial.render": "form:sidebar", "form:j_idt52": "form:j_idt52", "webscolaapp.Sidebar.ID_SUBMENU": MENU_NOTES.submenuId, ...FORM(idInit), "javax.faces.ViewState": vs2 }, true);
	return (await post({ ...FORM(idInit), "javax.faces.ViewState": vs2, "form:sidebar": "form:sidebar", "form:sidebar_menuid": MENU_NOTES.buttonId }, false)).text();
}

// ---------- Programme ----------
async function main() {
	if (!LOCAL_HTML && !PASS) { console.log("Pas de secret LISE_PASSWORD : notes non synchronisées."); return; }
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
