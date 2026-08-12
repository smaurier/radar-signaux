import { QualificationService } from './qualification.service';

/**
 * Tests de non-regression sur le garde-fou de coherence nom/domaine,
 * ajoute suite au faux positif reel du 11/08 (SIREN de Salesforce France
 * retourne au lieu de celui de Caroll, a cause du bug RCS documente dans
 * mentions-legales.service.spec.ts). Sans ce garde-fou, un mauvais SIREN
 * en amont produit silencieusement un "prospect qualifie" attache a la
 * mauvaise entreprise.
 */
describe('QualificationService', () => {
  const service = new QualificationService();
  const coherent = (nomComplet: string, domaine: string) =>
    (
      service as unknown as { coherentAvecDomaine: (n: string, d: string) => boolean }
    ).coherentAvecDomaine(nomComplet, domaine);
  const trancheDepasseSeuil = (tranche: string | null) =>
    (
      service as unknown as { trancheDepasseSeuil: (t: string | null) => boolean | null }
    ).trancheDepasseSeuil(tranche);

  describe('coherentAvecDomaine', () => {
    it('reconnait le vrai cas Caroll comme coherent', () => {
      expect(coherent('CAROLL INTERNATIONAL', 'www.caroll.com')).toBe(true);
    });

    it('detecte le faux positif reel du 11/08 (Salesforce sur le domaine caroll.com)', () => {
      expect(coherent('SALESFORCE.COM FRANCE', 'www.caroll.com')).toBe(false);
    });

    it('reste permissif sur un coeur de domaine trop court pour juger', () => {
      expect(coherent('UNE ENTREPRISE QUELCONQUE', 'ab.fr')).toBe(true);
    });
  });

  describe('trancheDepasseSeuil (seuil EAA >10 salaries)', () => {
    it('sous le seuil (3-5 salaries, tranche "02")', () => {
      expect(trancheDepasseSeuil('02')).toBe(false);
    });

    it('au seuil (10-19 salaries, tranche "11")', () => {
      expect(trancheDepasseSeuil('11')).toBe(true);
    });

    it('largement au-dessus (tranche "53", 10000+ salaries)', () => {
      expect(trancheDepasseSeuil('53')).toBe(true);
    });

    it('tranche absente -> indetermine (null), pas de fausse conclusion', () => {
      expect(trancheDepasseSeuil(null)).toBeNull();
    });
  });
});
