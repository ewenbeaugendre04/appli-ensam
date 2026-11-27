// Publie le calendrier « cours seulement » sur Netlify (adresse lisible, ex. https://cours-ensam.netlify.app/cours-ensam.ics).
// Lancé après sync.mjs, toutes les heures : chaque exécution remplace le fichier en ligne (abonnement toujours à jour).
// Secret GitHub NETLIFY_TOKEN : jeton d'accès personnel Netlify. Sans lui, rien n'est fait.
// Aucune dépendance externe. Node 20+.
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";

const TOKEN = process.env.NETLIFY_TOKEN;
const DATA_TOKEN = process.env.DATA_TOKEN;
const DATA_REPO = process.env.DATA_REPO || "ewenbeaugendre04/appli-ensam-data";
const DOSSIER = process.env.NETLIFY_DIR || "netlify-out";
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
async function retenirAdresse(url) {
	if (!DATA_TOKEN) return;
	const h = { Authorization: `Bearer ${DATA_TOKEN}`, Accept: "application/vnd.github+json" };
	const r = await fetch(`https://api.github.com/repos/${DATA_REPO}/contents/config.json`, { headers: h });
	if (!r.ok) return;
	const j = await r.json();
	const config = JSON.parse(Buffer.from(j.content, "base64").toString("utf8"));
	if (config.icsCoursUrl === url) return;
	config.icsCoursUrl = url;
	await fetch(`https://api.github.com/repos/${DATA_REPO}/contents/config.json`, {
		method: "PUT", headers: h,
		body: JSON.stringify({ message: "Calendrier cours : adresse Netlify", sha: j.sha, content: Buffer.from(JSON.stringify(config, null, 2) + "\n").toString("base64"), committer: { name: "Appli ENSAM", email: "appli-ensam@users.noreply.github.com" } }),
	});
}

async function main() {
	if (!TOKEN) { console.log("Pas de secret NETLIFY_TOKEN : calendrier non publié sur Netlify."); return; }
	const noms = (await readdir(DOSSIER)).filter((f) => !f.startsWith("."));
	const ics = noms.find((f) => f.endsWith(".ics"));
	if (!ics) throw new Error(`Aucun .ics dans ${DOSSIER}`);
	const fichiers = {};
	for (const f of noms) fichiers[f] = await readFile(`${DOSSIER}/${f}`);
	const s = await site(ics.replace(/\.ics$/, ""));
	// Déploiement par empreintes : on annonce les fichiers, Netlify demande ceux qu'il n'a pas
	const empreintes = Object.fromEntries(Object.entries(fichiers).map(([f, b]) => ["/" + f, createHash("sha1").update(b).digest("hex")]));
	const dep = await (await nf(`/sites/${s.id}/deploys`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: empreintes }) })).json();
	for (const [f, b] of Object.entries(fichiers)) {
		if (!(dep.required || []).includes(empreintes["/" + f])) continue;
		await nf(`/deploys/${dep.id}/files/${encodeURIComponent(f)}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: b });
	}
	const url = `${(s.ssl_url || s.url || `https://${s.name}.netlify.app`).replace(/^http:/, "https:")}/${ics}`;
	console.log(`Calendrier cours publié : ${url}`);
	await retenirAdresse(url);
}

main().catch((e) => { console.log(`::warning title=Netlify::${String(e.message).replace(/\n/g, " ")}`); process.exitCode = 1; });
