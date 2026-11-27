// Publie les calendriers des deux groupes sur Netlify, à une adresse lisible :
//   https://cours-ensam.netlify.app/groupe2.ics (toi) et https://cours-ensam.netlify.app/groupe1.ics (camarade).
// Lancé après sync.mjs, qui écrit les fichiers dans netlify-out/ (cours + partiels, jamais les tâches).
// Secret GitHub NETLIFY_TOKEN : jeton d'accès personnel Netlify. Sans lui, rien n'est fait. Node 20+.
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";

const TOKEN = process.env.NETLIFY_TOKEN;
const DATA_TOKEN = process.env.DATA_TOKEN;
const DATA_REPO = process.env.DATA_REPO || "ewenbeaugendre04/appli-ensam-data";
const DOSSIER = process.env.NETLIFY_DIR || "netlify-out";
const NOM_SITE = process.env.NETLIFY_SITE || "cours-ensam";
const API = "https://api.netlify.com/api/v1";

async function nf(path, opts = {}) {
	const r = await fetch(API + path, { ...opts, headers: { Authorization: `Bearer ${TOKEN}`, ...(opts.headers || {}) } });
	if (!r.ok && !opts.tolerer?.includes(r.status)) throw new Error(`Netlify ${opts.method || "GET"} ${path} : ${r.status} ${(await r.text()).slice(0, 200)}`);
	return r;
}

// Le site Netlify : on le retrouve par son nom, sinon on le crée (nom libre le plus proche)
async function site(nomVoulu) {
	const tous = await (await nf("/sites?filter=all&per_page=100")).json();
	const existant = tous.find((s) => s.name === nomVoulu || s.name.startsWith(nomVoulu + "-"));
	if (existant) return existant;
	for (const nom of [nomVoulu, `${nomVoulu}-ewen`, `${nomVoulu}-${Math.random().toString(36).slice(2, 6)}`]) {
		const r = await nf("/sites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: nom }), tolerer: [422] });
		if (r.ok) { console.log(`Site Netlify créé : ${nom}`); return r.json(); }
	}
	throw new Error("Impossible de créer le site Netlify (nom déjà pris)");
}

// Mémorise l'adresse dans config.json (affichée dans Réglages)
async function retenirAdresses(urls) {
	if (!DATA_TOKEN) return;
	const h = { Authorization: `Bearer ${DATA_TOKEN}`, Accept: "application/vnd.github+json" };
	const r = await fetch(`https://api.github.com/repos/${DATA_REPO}/contents/config.json`, { headers: h });
	if (!r.ok) return;
	const j = await r.json();
	const config = JSON.parse(Buffer.from(j.content, "base64").toString("utf8"));
	if (JSON.stringify(config.netlify || {}) === JSON.stringify(urls)) return;
	config.netlify = urls;
	await fetch(`https://api.github.com/repos/${DATA_REPO}/contents/config.json`, {
		method: "PUT", headers: h,
		body: JSON.stringify({ message: "Calendriers : adresses Netlify", sha: j.sha, content: Buffer.from(JSON.stringify(config, null, 2) + "\n").toString("base64"), committer: { name: "Appli ENSAM", email: "appli-ensam@users.noreply.github.com" } }),
	});
}

async function main() {
	if (!TOKEN) { console.log("Pas de secret NETLIFY_TOKEN : calendriers non publiés sur Netlify."); return; }
	const noms = (await readdir(DOSSIER)).filter((f) => !f.startsWith(".") || f === "_headers");
	const ics = noms.filter((f) => f.endsWith(".ics"));
	if (!ics.length) throw new Error(`Aucun .ics dans ${DOSSIER}`);
	const fichiers = {};
	for (const f of noms) fichiers[f] = await readFile(`${DOSSIER}/${f}`);
	const s = await site(NOM_SITE);
	// Netlify protège par défaut les sites des nouveaux comptes (connexion Netlify obligatoire) :
	// les calendriers doivent être publics pour que Calendrier puisse s'y abonner.
	if (s.sso_login || (s.password_context === "all" && s.has_password)) {
		const r = await nf(`/sites/${s.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sso_login: false, sso_login_context: "non_production", password_context: "non_production" }), tolerer: [400, 403, 422] });
		const apres = r.ok ? await r.json() : null;
		console.log(`Protection du site : ${r.status} → sso_login=${apres?.sso_login} contexte=${apres?.sso_login_context}`);
		if (apres) Object.assign(s, apres);
	}
	const base = (s.ssl_url || s.url || `https://${s.name}.netlify.app`).replace(/^http:/, "https:");
	const urls = Object.fromEntries(ics.map((f) => [f.replace(/\.ics$/, ""), `${base}/${f}`]));
	// Rien de changé (hors horodatage DTSTAMP) : pas de nouveau déploiement
	const sansHorodatage = (t) => String(t).replace(/^DTSTAMP:.*$/gm, "");
	let pareil = true;
	for (const f of ics) {
		try {
			const r = await fetch(`${base}/${f}`, { cache: "no-store" });
			if (!r.ok || sansHorodatage(await r.text()) !== sansHorodatage(fichiers[f].toString("utf8"))) { pareil = false; break; }
		} catch { pareil = false; break; }
	}
	if (pareil) { console.log("Calendriers inchangés et accessibles : pas de nouveau déploiement Netlify."); await retenirAdresses(urls); return; }
	// Déploiement par empreintes : on annonce les fichiers, Netlify demande ceux qu'il n'a pas
	const empreintes = Object.fromEntries(Object.entries(fichiers).map(([f, b]) => ["/" + f, createHash("sha1").update(b).digest("hex")]));
	const dep = await (await nf(`/sites/${s.id}/deploys`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: empreintes }) })).json();
	for (const [f, b] of Object.entries(fichiers)) {
		if (!(dep.required || []).includes(empreintes["/" + f])) continue;
		await nf(`/deploys/${dep.id}/files/${encodeURIComponent(f)}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: b });
	}
	for (let i = 0; i < 10; i++) {
		const etat = await (await nf(`/deploys/${dep.id}`)).json();
		if (etat.state === "ready" || etat.state === "error") { console.log(`Déploiement Netlify : ${etat.state}${etat.error_message ? " — " + etat.error_message : ""}`); break; }
		await new Promise((r) => setTimeout(r, 2000));
	}
	// Vérification : chaque fichier doit répondre en 200, en text/calendar, et commencer par BEGIN:VCALENDAR
	for (const [nom, url] of Object.entries(urls)) {
		try {
			const r = await fetch(url, { cache: "no-store" });
			const t = await r.text();
			console.log(`${nom} : ${url} → HTTP ${r.status}, ${r.headers.get("content-type")}, « ${t.slice(0, 30).replace(/\s+/g, " ")} »`);
		} catch (e) { console.log(`${nom} : vérification impossible (${e.message})`); }
	}
	await retenirAdresses(urls);
}

main().catch((e) => { console.log(`::warning title=Netlify::${String(e.message).replace(/\n/g, " ")}`); process.exitCode = 1; });
