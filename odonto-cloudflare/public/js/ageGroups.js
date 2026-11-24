// Copie côté client de la logique de tranches d'âge (voir src/utils/ageGroups.js
// côté serveur — gardez les deux en phase si les tranches SNIS changent).
export const AGE_GROUPS = [
  '0-11 mois',
  '12-59 mois',
  '5-9ans',
  '10-14 ans',
  '15-19 ans',
  '20-24 ans',
  '25-49 ans',
  '50-59 ans',
  '60ans et +',
  'Age ND',
];

export function computeAgeGroup(dateNaissance, atDate = new Date()) {
  if (!dateNaissance) return 'Age ND';
  const dob = new Date(dateNaissance);
  const ref = new Date(atDate);
  if (Number.isNaN(dob.getTime()) || Number.isNaN(ref.getTime()) || dob > ref) return 'Age ND';

  let months = (ref.getFullYear() - dob.getFullYear()) * 12 + (ref.getMonth() - dob.getMonth());
  if (ref.getDate() < dob.getDate()) months -= 1;
  if (months < 0) return 'Age ND';

  if (months <= 11) return '0-11 mois';
  if (months <= 59) return '12-59 mois';
  const years = Math.floor(months / 12);
  if (years <= 9) return '5-9ans';
  if (years <= 14) return '10-14 ans';
  if (years <= 19) return '15-19 ans';
  if (years <= 24) return '20-24 ans';
  if (years <= 49) return '25-49 ans';
  if (years <= 59) return '50-59 ans';
  return '60ans et +';
}

export function formatAge(dateNaissance) {
  if (!dateNaissance) return '—';
  const group = computeAgeGroup(dateNaissance);
  const dob = new Date(dateNaissance);
  const now = new Date();
  let years = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) years -= 1;
  if (years < 1) {
    let months = (now.getFullYear() - dob.getFullYear()) * 12 + (now.getMonth() - dob.getMonth());
    if (now.getDate() < dob.getDate()) months -= 1;
    return `${Math.max(months, 0)} mois (${group})`;
  }
  return `${years} ans (${group})`;
}
