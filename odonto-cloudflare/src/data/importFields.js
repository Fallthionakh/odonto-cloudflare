// Dictionnaire des rubriques reconnues pour l'import Excel (identique à
// odonto-app/src/data/importFields.json, converti en export ES).
'use strict';

export default {
  "patient": {
    "nom": { "label": "Nom", "required": true, "synonyms": ["nom", "nom patient", "nom du patient", "lastname", "last name", "nom de famille"] },
    "prenom": { "label": "Prénom", "required": true, "synonyms": ["prenom", "prénom", "prenom patient", "prénom du patient", "firstname", "first name"] },
    "sexe": { "label": "Sexe", "required": true, "type": "enum", "values": { "M": ["m", "masculin", "homme", "male"], "F": ["f", "feminin", "féminin", "femme", "female"] }, "synonyms": ["sexe", "genre", "sex"] },
    "date_naissance": { "label": "Date de naissance", "type": "date", "synonyms": ["date de naissance", "date naissance", "naissance", "ddn", "date of birth", "dob", "ne le", "née le"] },
    "telephone": { "label": "Téléphone", "synonyms": ["telephone", "téléphone", "tel", "tél", "numero de telephone", "numéro de téléphone", "phone", "contact telephone patient"] },
    "adresse": { "label": "Adresse", "synonyms": ["adresse", "address", "residence", "résidence", "domicile", "lieu de residence"] },
    "contact_nom": { "label": "Nom du contact (urgence)", "synonyms": ["nom du contact", "personne a contacter", "personne à contacter", "contact urgence", "nom contact", "contact en cas d'urgence"] },
    "contact_telephone": { "label": "Téléphone du contact", "synonyms": ["telephone contact", "téléphone contact", "tel contact", "telephone urgence", "téléphone urgence"] },
    "numero_dossier": { "label": "Numéro de dossier", "synonyms": ["numero de dossier", "numéro de dossier", "n dossier", "no dossier", "dossier", "id patient", "matricule", "numero dossier"] }
  },
  "consultation": {
    "date_consultation": { "label": "Date de consultation", "type": "date", "synonyms": ["date de consultation", "date consultation", "date", "date visite", "date rdv", "date de la consultation"] },
    "type_cas": { "label": "Type de cas", "type": "enum", "values": { "nouveau": ["nouveau", "nouveau cas", "new"], "ancien": ["ancien", "ancien cas", "old"] }, "synonyms": ["type de cas", "type cas", "statut cas"] },
    "statut_reference": { "label": "Statut de référence", "type": "enum", "values": { "aucun": ["aucun", "non", "-"], "refere": ["refere", "référé", "reference", "référence"], "contre_refere": ["contre refere", "contre référé", "contre reference"], "vu_par_reference": ["vu par reference", "vu par référence"] }, "synonyms": ["statut de reference", "statut de référence", "reference", "référence"] },
    "motif": { "label": "Motif de consultation", "synonyms": ["motif", "motif de consultation", "plainte", "motif consultation"] },
    "antecedents": { "label": "Antécédents", "synonyms": ["antecedents", "antécédents", "atcd"] },
    "examen_clinique": { "label": "Examen clinique", "synonyms": ["examen clinique", "examen", "observation clinique"] },
    "cat_observation": { "label": "Conduite à tenir / observation", "synonyms": ["conduite a tenir", "conduite à tenir", "cat", "observation"] },
    "grossesse": { "label": "Grossesse", "type": "bool", "synonyms": ["grossesse", "enceinte", "femme enceinte"] },
    "issue": { "label": "Issue", "type": "enum", "values": { "vivant": ["vivant", "vivante", "alive"], "decede": ["decede", "décédé", "décédée", "deces", "décès", "dead"] }, "synonyms": ["issue", "devenir", "statut patient"] },
    "cause_deces": { "label": "Cause de décès (si issue = décédé)", "type": "enum_dynamic:mortalite", "synonyms": ["cause de deces", "cause de décès", "cause deces", "cause du deces", "cause du décès"] },
    "rendez_vous_suivi": { "label": "Rendez-vous de suivi", "type": "date", "synonyms": ["rendez-vous de suivi", "rdv de suivi", "rdv suivi", "prochain rdv", "prochain rendez-vous"] },
    "type_paiement": { "label": "Type de paiement", "type": "enum", "values": { "PAF": ["paf"], "LG": ["lg", "lettre de garantie"], "PERSONNEL": ["personnel"], "CAS_SOCIAL": ["cas social", "social"] }, "synonyms": ["type de paiement", "mode de paiement", "paiement"] },
    "montant_prise_en_charge": { "label": "Montant pris en charge", "type": "number", "synonyms": ["montant pris en charge", "prise en charge", "part employeur", "montant prise en charge"] },
    "montant_patient_paye": { "label": "Montant payé par le patient", "type": "number", "synonyms": ["montant paye", "montant payé", "montant payé par le patient", "part patient", "montant patient"] },
    "diagnostics": { "label": "Diagnostic(s)", "type": "list", "synonyms": ["diagnostic", "diagnostics", "pathologie", "pathologies", "maladie"] },
    "traitements": { "label": "Traitement(s)", "type": "list", "synonyms": ["traitement", "traitements", "soins", "acte"] }
  }
};
