# -*- coding: utf-8 -*-
"""
Simulation pédagogique de Code_Aster et de Salome (GEOM) pour s'entraîner dans le navigateur.
Mêmes noms de commandes et de mots-clés que les vrais logiciels, contrôles des erreurs courantes,
et résultats analytiques (barre, poutre) à la place d'un vrai calcul éléments finis.
"""
import math

# ======================================================================
#  Maillages connus (ce que LIRE_MAILLAGE « lit »)
# ======================================================================
MAILLAGES = {
    "barre": dict(type="barre", L=100.0, b=10.0, h=10.0, groupes_ma=["BARRE", "ENCAS", "CHARGE"], groupes_no=["P_ENCAS", "P_BOUT"],
                  description="Barre 100 × 10 × 10 mm selon X. Volume BARRE, face ENCAS en x = 0, face CHARGE en x = 100."),
    "console": dict(type="console", L=500.0, b=20.0, h=40.0, groupes_ma=["POUTRE", "ENCAS", "BOUT"], groupes_no=["P_BOUT"],
                    description="Poutre 500 × 20 × 40 mm (h = 40 selon Y). Volume POUTRE, face ENCAS en x = 0, face BOUT en x = 500."),
}
_etat = {"maillage": "barre", "debut": False, "unites": {}}

def preparer(maillage="barre", unite=20):
    """Choisit le maillage associé à l'unité logique (fait par l'exercice)."""
    _etat["unites"][unite] = maillage
    _etat["maillage"] = maillage
    _etat["debut"] = False

class AsterError(Exception):
    """Erreur façon Code_Aster (<F> = erreur fatale)."""

def _F(**kw):
    return dict(kw)

def _liste(x):
    if x is None: return []
    if isinstance(x, dict): return [x]
    return list(x)

def _exige(kw, cles, commande):
    manque = [c for c in cles if c not in kw]
    if manque:
        raise AsterError(f"<F> {commande} : mot-clé obligatoire absent : {', '.join(manque)}")

def _groupes(kw):
    g = kw.get("GROUP_MA", kw.get("GROUP_NO"))
    if g is None: return []
    return [g] if isinstance(g, str) else list(g)

def _verifie_groupes(maillage, groupes, commande):
    m = MAILLAGES[maillage.nom]
    connus = m["groupes_ma"] + m["groupes_no"]
    for g in groupes:
        if g not in connus:
            raise AsterError(f"<F> {commande} : le groupe '{g}' n'existe pas dans le maillage. Groupes disponibles : {', '.join(connus)}")

# ======================================================================
#  Objets
# ======================================================================
class Maillage:
    def __init__(self, nom): self.nom = nom
    def __repr__(self): return f"<Maillage {self.nom} : {MAILLAGES[self.nom]['description']}>"
    def getGroupsOfCells(self): return list(MAILLAGES[self.nom]["groupes_ma"])
    def getGroupsOfNodes(self): return list(MAILLAGES[self.nom]["groupes_no"])

class Modele:
    def __init__(self, maillage, modelisation, phenomene): self.maillage, self.modelisation, self.phenomene = maillage, modelisation, phenomene
    def __repr__(self): return f"<Modele {self.phenomene} {self.modelisation}>"

class Materiau:
    def __init__(self, E, NU, RHO=None): self.E, self.NU, self.RHO = E, NU, RHO
    def __repr__(self): return f"<Materiau E={self.E} NU={self.NU}>"

class ChampMater:
    def __init__(self, maillage, affectations): self.maillage, self.affectations = maillage, affectations
    def materiau(self): return self.affectations[0][1]

class Chargement:
    def __init__(self, modele, blocages, forces): self.modele, self.blocages, self.forces = modele, blocages, forces

class Fonction:
    def __init__(self, para, x, y): self.para, self.x, self.y = para, x, y
    def __call__(self, t):
        x, y = self.x, self.y
        if t <= x[0]: return y[0]
        for i in range(1, len(x)):
            if t <= x[i]: return y[i - 1] + (y[i] - y[i - 1]) * (t - x[i - 1]) / (x[i] - x[i - 1])
        return y[-1]
    def __repr__(self): return f"<Fonction de {self.para} : {len(self.x)} points>"

class ListeReels(list):
    pass

class Champ:
    """Champ aux nœuds : valeurs rangées nœud par nœud, composante par composante."""
    def __init__(self, nom, composantes, valeurs, x):
        self.nom, self.composantes, self._v, self.x = nom, composantes, valeurs, x
    def getValues(self):
        return [v for noeud in self._v for v in noeud]
    def getComponents(self):
        return list(self.composantes)
    def getValuesWithDescription(self, composante):
        i = self.composantes.index(composante)
        return [n[i] for n in self._v], list(range(1, len(self._v) + 1))
    def __repr__(self): return f"<Champ {self.nom} : {len(self._v)} nœuds × {self.composantes}>"

class Resultat:
    def __init__(self, maillage, champs, inst=(1.0,)):
        self.maillage, self._champs, self._inst = maillage, champs, list(inst)
    def getField(self, nom, para=1):
        if nom not in self._champs:
            raise AsterError(f"<F> le champ {nom} n'existe pas dans le résultat. Champs calculés : {', '.join(self._champs)}. (Les contraintes se calculent avec CALC_CHAMP.)")
        return self._champs[nom]
    def getFieldNames(self): return list(self._champs)
    def getAccessParameters(self): return {"NUME_ORDRE": list(range(1, len(self._inst) + 1)), "INST": self._inst}
    def __repr__(self): return f"<Resultat : champs {', '.join(self._champs)}>"

# ======================================================================
#  Commandes
# ======================================================================
def DEBUT(**kw):
    _etat["debut"] = True
    print("   -- DEBUT : début de l'étude --")

def FIN(**kw):
    print("   -- FIN : fin de l'étude --")

def LIRE_MAILLAGE(**kw):
    if not _etat["debut"]: raise AsterError("<F> Il faut appeler DEBUT() avant toute commande.")
    unite = kw.get("UNITE", 20)
    nom = _etat["unites"].get(unite)
    if nom is None: raise AsterError(f"<F> LIRE_MAILLAGE : aucun fichier associé à l'unité logique {unite} (dans Astk/as_run, le maillage .med est déclaré en unité 20 par défaut).")
    if kw.get("FORMAT", "ASTER") != "MED": print("   <A> LIRE_MAILLAGE : un maillage issu de Salome se lit avec FORMAT='MED'.")
    return Maillage(nom)

def AFFE_MODELE(**kw):
    _exige(kw, ["MAILLAGE", "AFFE"], "AFFE_MODELE")
    affe = _liste(kw["AFFE"])
    for a in affe:
        _exige(a, ["PHENOMENE", "MODELISATION"], "AFFE_MODELE/AFFE")
        if "TOUT" not in a and "GROUP_MA" not in a: raise AsterError("<F> AFFE_MODELE/AFFE : il faut TOUT='OUI' ou GROUP_MA.")
        if a["PHENOMENE"] != "MECANIQUE": raise AsterError(f"<F> PHENOMENE='{a['PHENOMENE']}' : ici on fait de la MECANIQUE.")
    _verifie_groupes(kw["MAILLAGE"], [g for a in affe for g in _groupes(a)], "AFFE_MODELE")
    return Modele(kw["MAILLAGE"], affe[0]["MODELISATION"], affe[0]["PHENOMENE"])

def DEFI_MATERIAU(**kw):
    if "ELAS" not in kw: raise AsterError("<F> DEFI_MATERIAU : pour un calcul élastique il faut le mot-clé facteur ELAS=_F(E=..., NU=...).")
    e = kw["ELAS"]
    if not isinstance(e, dict): raise AsterError("<F> DEFI_MATERIAU : ELAS doit être écrit ELAS=_F(E=..., NU=...).")
    _exige(e, ["E", "NU"], "DEFI_MATERIAU/ELAS")
    if not (0 <= e["NU"] < 0.5): raise AsterError(f"<F> DEFI_MATERIAU : NU={e['NU']} impossible (0 ≤ NU < 0,5).")
    if isinstance(e["E"], int): print("   <A> DEFI_MATERIAU : E est un entier. Écris plutôt un réel (210000. ou 2.1e5) : Code_Aster attend des réels.")
    return Materiau(e["E"], e["NU"], e.get("RHO"))

def AFFE_MATERIAU(**kw):
    _exige(kw, ["AFFE"], "AFFE_MATERIAU")
    if "MAILLAGE" not in kw and "MODELE" not in kw: raise AsterError("<F> AFFE_MATERIAU : il faut MAILLAGE=... (ou MODELE=...).")
    maillage = kw.get("MAILLAGE") or kw["MODELE"].maillage
    aff = []
    for a in _liste(kw["AFFE"]):
        _exige(a, ["MATER"], "AFFE_MATERIAU/AFFE")
        if "TOUT" not in a and "GROUP_MA" not in a: raise AsterError("<F> AFFE_MATERIAU/AFFE : il faut TOUT='OUI' ou GROUP_MA.")
        _verifie_groupes(maillage, _groupes(a), "AFFE_MATERIAU")
        aff.append((a.get("GROUP_MA", "TOUT"), a["MATER"]))
    return ChampMater(maillage, aff)

def AFFE_CHAR_MECA(**kw):
    _exige(kw, ["MODELE"], "AFFE_CHAR_MECA")
    mod = kw["MODELE"]
    blocs, forces = [], []
    for d in _liste(kw.get("DDL_IMPO")):
        _verifie_groupes(mod.maillage, _groupes(d), "AFFE_CHAR_MECA/DDL_IMPO")
        ddl = {k: v for k, v in d.items() if k in ("DX", "DY", "DZ", "DRX", "DRY", "DRZ")}
        if not ddl: raise AsterError("<F> DDL_IMPO : indique au moins un degré de liberté (DX=0., DY=0., DZ=0.).")
        blocs.append((_groupes(d), ddl))
    for nom in ("FORCE_FACE", "PRES_REP", "FORCE_NODALE"):
        for f in _liste(kw.get(nom)):
            _verifie_groupes(mod.maillage, _groupes(f), f"AFFE_CHAR_MECA/{nom}")
            forces.append((nom, _groupes(f), f))
    if not blocs and not forces: raise AsterError("<F> AFFE_CHAR_MECA : aucun chargement ni blocage défini.")
    return Chargement(mod, blocs, forces)

def DEFI_FONCTION(**kw):
    _exige(kw, ["NOM_PARA", "VALE"], "DEFI_FONCTION")
    v = list(kw["VALE"])
    if len(v) % 2: raise AsterError("<F> DEFI_FONCTION : VALE doit contenir des couples (x1, y1, x2, y2, ...) : nombre pair de valeurs.")
    x, y = v[0::2], v[1::2]
    if any(b <= a for a, b in zip(x, x[1:])): raise AsterError("<F> DEFI_FONCTION : les abscisses doivent être strictement croissantes.")
    return Fonction(kw["NOM_PARA"], x, y)

def DEFI_LIST_REEL(**kw):
    _exige(kw, ["DEBUT"], "DEFI_LIST_REEL")
    l = ListeReels([kw["DEBUT"]])
    for i in _liste(kw.get("INTERVALLE")):
        _exige(i, ["JUSQU_A"], "DEFI_LIST_REEL/INTERVALLE")
        a, b = l[-1], i["JUSQU_A"]
        n = i.get("NOMBRE") or round((b - a) / i["PAS"])
        l += [a + (b - a) * k / n for k in range(1, n + 1)]
    return l

def _bloque_dx(ch, groupe_fixe):
    return any(groupe_fixe in g and "DX" in d and d["DX"] == 0 for g, d in ch.blocages)

def MECA_STATIQUE(**kw):
    _exige(kw, ["MODELE", "CHAM_MATER", "EXCIT"], "MECA_STATIQUE")
    mod, cm = kw["MODELE"], kw["CHAM_MATER"]
    charges = [e.get("CHARGE") for e in _liste(kw["EXCIT"])]
    if None in charges: raise AsterError("<F> MECA_STATIQUE/EXCIT : chaque occurrence doit contenir CHARGE=...")
    m = MAILLAGES[mod.maillage.nom]
    fixe = "ENCAS"
    if not any(_bloque_dx(c, fixe) for c in charges):
        raise AsterError("<F> MECA_STATIQUE : la matrice de rigidité est singulière : la structure n'est pas bloquée (mouvement de corps rigide). Bloque le groupe ENCAS avec DDL_IMPO (DX=0., DY=0., DZ=0.).")
    if mod.modelisation not in ("3D", "D_PLAN", "C_PLAN", "POU_D_E", "POU_D_T"):
        raise AsterError(f"<F> MODELISATION='{mod.modelisation}' inconnue.")
    mat = cm.materiau()
    E, NU = mat.E, mat.NU
    if E < 1e3: print(f"   <A> E = {E} semble très petit : vérifie tes unités (MPa avec un maillage en mm).")
    S = m["b"] * m["h"]
    # effort résultant appliqué en bout, à partir des chargements
    Fx = Fy = 0.0
    for c in charges:
        for nom, g, f in c.forces:
            aire = S
            if nom == "FORCE_FACE": Fx += f.get("FX", 0.0) * aire; Fy += f.get("FY", 0.0) * aire
            elif nom == "PRES_REP": Fx += -f.get("PRES", 0.0) * aire  # pression > 0 = compression
            elif nom == "FORCE_NODALE": Fx += f.get("FX", 0.0); Fy += f.get("FY", 0.0)
    L, n = m["L"], 11
    xs = [L * i / (n - 1) for i in range(n)]
    I = m["b"] * m["h"] ** 3 / 12
    depl = []
    for x in xs:
        ux = Fx * x / (E * S)
        uy = Fy * x * x * (3 * L - x) / (6 * E * I)
        uz = -NU * Fx / (E * S) * 0.0
        depl.append([ux, uy, uz])
    champs = {"DEPL": Champ("DEPL", ["DX", "DY", "DZ"], depl, xs)}
    res = Resultat(mod.maillage, champs)
    res._donnees = dict(Fx=Fx, Fy=Fy, E=E, NU=NU, S=S, I=I, L=L, xs=xs, h=m["h"])
    print(f"   -- MECA_STATIQUE : calcul élastique linéaire terminé ({n} nœuds sur l'axe) --")
    return res

def CALC_CHAMP(**kw):
    _exige(kw, ["RESULTAT"], "CALC_CHAMP")
    r = kw["RESULTAT"]
    d = getattr(r, "_donnees", None)
    if d is None: raise AsterError("<F> CALC_CHAMP : RESULTAT doit être issu de MECA_STATIQUE.")
    demandes = list(_liste(kw.get("CONTRAINTE"))) + list(_liste(kw.get("CRITERES"))) + list(_liste(kw.get("DEFORMATION")))
    if not demandes: raise AsterError("<F> CALC_CHAMP : rien à calculer. Exemple : CONTRAINTE=('SIGM_NOEU',), CRITERES=('SIEQ_NOEU',).")
    sig = []
    for x in d["xs"]:
        sxx = d["Fx"] / d["S"] + d["Fy"] * (d["L"] - x) * (d["h"] / 2) / d["I"]
        sig.append(sxx)
    for c in demandes:
        if c in ("SIGM_NOEU", "SIGM_ELNO"):
            r._champs[c] = Champ(c, ["SIXX", "SIYY", "SIZZ", "SIXY", "SIXZ", "SIYZ"], [[s, 0, 0, 0, 0, 0] for s in sig], d["xs"])
        elif c in ("SIEQ_NOEU", "SIEQ_ELNO"):
            r._champs[c] = Champ(c, ["VMIS", "TRESCA"], [[abs(s), abs(s)] for s in sig], d["xs"])
        elif c in ("EPSI_NOEU", "EPSI_ELNO"):
            r._champs[c] = Champ(c, ["EPXX"], [[s / d["E"]] for s in sig], d["xs"])
        else:
            raise AsterError(f"<F> CALC_CHAMP : option {c} inconnue ici (essaie SIGM_NOEU, SIEQ_NOEU, EPSI_NOEU).")
    print(f"   -- CALC_CHAMP : {', '.join(demandes)} calculé(s) --")
    return r

def IMPR_RESU(**kw):
    _exige(kw, ["RESU"], "IMPR_RESU")
    print(f"   -- IMPR_RESU : résultats écrits au format {kw.get('FORMAT', 'RESULTAT')} (à ouvrir dans ParaVis) --")

COMMANDES = dict(DEBUT=DEBUT, FIN=FIN, LIRE_MAILLAGE=LIRE_MAILLAGE, AFFE_MODELE=AFFE_MODELE, DEFI_MATERIAU=DEFI_MATERIAU,
                 AFFE_MATERIAU=AFFE_MATERIAU, AFFE_CHAR_MECA=AFFE_CHAR_MECA, MECA_STATIQUE=MECA_STATIQUE, CALC_CHAMP=CALC_CHAMP,
                 IMPR_RESU=IMPR_RESU, DEFI_FONCTION=DEFI_FONCTION, DEFI_LIST_REEL=DEFI_LIST_REEL, _F=_F)

# ======================================================================
#  Salome GEOM (sous-ensemble)
# ======================================================================
class Forme:
    def __init__(self, nom, volume, surface=None, cdg=(0, 0, 0)):
        self.nom, self.volume, self.surface, self.cdg = nom, volume, surface, cdg
    def __repr__(self): return f"<GEOM_Object {self.nom}>"

class GeomBuilder:
    def MakeBoxDXDYDZ(self, dx, dy, dz):
        for v in (dx, dy, dz):
            if v <= 0: raise ValueError("MakeBoxDXDYDZ : les dimensions doivent être > 0")
        return Forme("Box", dx * dy * dz, 2 * (dx * dy + dy * dz + dx * dz), (dx / 2, dy / 2, dz / 2))
    def MakeCylinderRH(self, r, h):
        if r <= 0 or h <= 0: raise ValueError("MakeCylinderRH : rayon et hauteur > 0")
        return Forme("Cylinder", math.pi * r * r * h, 2 * math.pi * r * (r + h), (0, 0, h / 2))
    def MakeSphereR(self, r):
        return Forme("Sphere", 4 / 3 * math.pi * r ** 3, 4 * math.pi * r * r)
    def MakeTranslation(self, forme, dx, dy, dz):
        x, y, z = forme.cdg
        return Forme(forme.nom + "_trans", forme.volume, forme.surface, (x + dx, y + dy, z + dz))
    def MakeCut(self, a, b):
        if b.volume >= a.volume: raise ValueError("MakeCut : l'outil enlève toute la pièce")
        return Forme("Cut", a.volume - b.volume)
    def MakeFuse(self, a, b):
        return Forme("Fuse", a.volume + b.volume)
    def BasicProperties(self, forme):
        return (0.0, forme.surface if forme.surface is not None else float("nan"), forme.volume)
    def addToStudy(self, forme, nom):
        forme.nom = nom
        print(f"   -- objet '{nom}' ajouté à l'arbre d'étude --")
        return nom

def installer(espace):
    """Injecte les commandes dans l'espace de noms (comme dans un fichier .comm)."""
    espace.update(COMMANDES)
