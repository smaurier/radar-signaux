import { isSecteurTechProbable } from './entreprises.service';

/**
 * Test bati sur le vrai cas Galeon (11/08) : jugement a l'oeil sur les
 * noms d'entreprise avait classe Galeon (NAF 62.01Z, section J) comme
 * PME locale anodine -- cette heuristique verifiable remplace ce
 * jugement, sans jamais filtrer/supprimer un signal (accessoire d'affichage).
 */
describe('isSecteurTechProbable', () => {
  it('reconnait Galeon (NAF 62.01Z, section J) comme tech probable', () => {
    expect(isSecteurTechProbable('62.01Z', 'J')).toBe(true);
  });

  it('reconnait la section J seule, meme sans code NAF precis', () => {
    expect(isSecteurTechProbable(null, 'J')).toBe(true);
  });

  it('rejette un NAF hors des prefixes tech connus', () => {
    expect(isSecteurTechProbable('47.71Z', null)).toBe(false); // commerce de detail (Caroll)
  });

  it('rejette si ni NAF ni section fournis', () => {
    expect(isSecteurTechProbable(null, null)).toBe(false);
  });
});
