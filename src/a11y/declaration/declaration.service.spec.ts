import { DeclarationService } from './declaration.service';

/**
 * Tests de non-regression sur les cas REELS rencontres le 11/08 : le
 * premier motif ("Accessibilite : totalement/partiellement/non conforme")
 * ratait completement la formulation narrative de caroll.com, resultat
 * initial : Caroll classe a tort "absente" alors qu'ils ont une vraie
 * declaration. Ces tests figent les deux formulations desormais reconnues.
 */
describe('DeclarationService', () => {
  // pageFetcher non utilise par chercherDeclaration (methode pure) --
  // dependance non fournie volontairement, jamais appelee dans ces tests
  const service = new DeclarationService(undefined as never);
  const chercher = (html: string) => (service as unknown as { chercherDeclaration: (h: string) => string | null }).chercherDeclaration(html);

  it('reconnait le texte normalise standard "totalement conforme"', () => {
    expect(chercher('<p>Accessibilité : totalement conforme</p>')).toBe('conforme');
  });

  it('reconnait le texte normalise standard "partiellement conforme"', () => {
    expect(chercher('<footer>Accessibilité : partiellement conforme</footer>')).toBe('partiel');
  });

  it('reconnait le texte normalise standard "non conforme"', () => {
    expect(chercher('Accessibilité : non conforme')).toBe('non_conforme');
  });

  it('reconnait la formulation narrative reelle de caroll.com (groupe Beaumanoir)', () => {
    const texte =
      "En date du 17 décembre 2025, le site de Caroll est non conforme au Référentiel " +
      "Général d'Amélioration de l'Accessibilité (RGAA) dans sa version 4.1.2.";
    expect(chercher(texte)).toBe('non_conforme');
  });

  it('reconnait la formulation narrative avec "totalement"', () => {
    const texte = 'le site de Exemple SAS est totalement conforme au RGAA.';
    expect(chercher(texte)).toBe('conforme');
  });

  it('ne trouve rien sur une page sans mention accessibilite (vrai negatif)', () => {
    expect(chercher('<html><body>Bienvenue sur notre boutique en ligne</body></html>')).toBeNull();
  });

  it('tolere un caractere de remplacement a la place de l\'accent (encodage non-UTF8)', () => {
    // "l�gales" simule un site non servi en UTF-8 propre (constate en
    // direct le 11/08 sur d'autres pages du meme type de site)
    expect(chercher('Accessibilit� : non conforme')).toBe('non_conforme');
  });
});
