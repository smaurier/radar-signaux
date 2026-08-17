import { MentionsLegalesService } from './mentions-legales.service';

/**
 * Tests de non-regression sur le vrai bug du 11/08 : la regex RCS avec
 * une classe de caracteres etroite ratait le SIREN de caroll.com ("RCS
 * de SAINT-MALO sous le n° 582 001 707", le symbole "n°" cassait le
 * match) -- un fallback recuperait alors le SIREN d'une tout autre
 * societe (Salesforce France). Ces tests figent le comportement corrige.
 */
describe('MentionsLegalesService', () => {
  const service = new MentionsLegalesService(undefined as never);
  const chercherSiren = (html: string) =>
    (
      service as unknown as { chercherSiren: (h: string) => string | null }
    ).chercherSiren(html);
  const trouverLien = (html: string, base: string) =>
    (
      service as unknown as {
        trouverLienMentionsLegales: (h: string, b: string) => string | null;
      }
    ).trouverLienMentionsLegales(html, base);

  describe('chercherSiren', () => {
    it('trouve un SIREN au format direct "SIREN : X"', () => {
      expect(chercherSiren('Mentions légales - SIREN : 330 267 691')).toBe(
        '330267691',
      );
    });

    it('trouve un SIREN via SIRET (garde les 9 premiers chiffres)', () => {
      expect(chercherSiren('SIRET : 330 267 691 00377')).toBe('330267691');
    });

    it('trouve le vrai SIREN de Caroll via la formulation "RCS de VILLE sous le n° X" (bug corrige)', () => {
      const texte =
        "L'éditeur du site www.caroll.com est la société CAROLL INTERNATIONAL, société " +
        'anonyme au capital de 21 966 966,85 euros, immatriculée au RCS de SAINT-MALO ' +
        'sous le n° 582 001 707 et dont le siège social est situé...';
      expect(chercherSiren(texte)).toBe('582001707');
    });

    it('ne trouve rien sur une page sans mention SIREN/SIRET/RCS', () => {
      expect(chercherSiren('<html><body>Bienvenue</body></html>')).toBeNull();
    });
  });

  describe('trouverLienMentionsLegales', () => {
    it("trouve le lien via le mot dans l'URL (priorite 1, meme si texte du lien mal encode)", () => {
      const html =
        '<a href="/fr/content/2-mentions-legales" class="x">Mentions l�gales</a>';
      expect(trouverLien(html, 'https://exemple.fr')).toBe(
        'https://exemple.fr/fr/content/2-mentions-legales',
      );
    });

    it('resout une URL relative par rapport au domaine de base', () => {
      const html = '<a href="mentions-legales.html">Mentions</a>';
      expect(trouverLien(html, 'https://exemple.fr')).toBe(
        'https://exemple.fr/mentions-legales.html',
      );
    });

    it('retourne null si aucun lien mentions legales trouve', () => {
      expect(
        trouverLien('<a href="/contact">Contact</a>', 'https://exemple.fr'),
      ).toBeNull();
    });
  });
});
