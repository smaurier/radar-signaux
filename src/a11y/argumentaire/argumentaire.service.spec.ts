import { ArgumentaireService } from './argumentaire.service';

/**
 * Tests de non-regression sur la bascule de regime juridique selon le CA
 * reel. Nos prospects sont filtres par un PLANCHER (>2M€ CA), pas un
 * plafond -- sans cette bascule, une entreprise a CA >250M€ recevrait un
 * argumentaire EAA/code conso errone (mauvaise autorite, mauvais texte,
 * mauvaises sanctions), reproduisant exactement l'erreur du TJ de Lille
 * (05-06/05/2026, mauvais seuil applique, deboute pour ca).
 */
describe('ArgumentaireService', () => {
  const service = new ArgumentaireService();

  const prospectDeBase = {
    domaine: 'exemple.fr',
    nomComplet: 'EXEMPLE SAS',
    siren: '123456789',
    nafCode: '47.11Z',
    statutDeclaration: 'absente',
    sourceUrlDeclaration: null,
    scanTotalViolations: null,
    scanTopViolations: null,
  };

  it('regime EAA code conso pour un CA sous 250M€', () => {
    const resultat = service.genererArgumentaire({ ...prospectDeBase, ca: 133_702_922 });
    const paragrapheRegime = resultat.texte.split('\n\n')[0];
    expect(resultat.regime).toBe('eaa_code_conso');
    // le paragraphe de regime lui-meme doit citer DGCCRF comme autorite,
    // jamais Arcom -- "Arcom" peut legitimement apparaitre plus loin dans
    // le rappel qui dit explicitement de ne PAS le citer pour ce regime
    expect(paragrapheRegime).toContain('DGCCRF');
    expect(paragrapheRegime).not.toContain('Arcom');
  });

  it('bascule vers art.47/Arcom au-dessus de 250M€ (jamais un texte EAA errone)', () => {
    const resultat = service.genererArgumentaire({ ...prospectDeBase, ca: 300_000_000 });
    expect(resultat.regime).toBe('art47_arcom');
    expect(resultat.texte).toContain('Arcom');
    expect(resultat.texte).toContain('A VERIFIER');
  });

  it('pile au seuil (250M€) bascule deja vers art.47 (>=)', () => {
    const resultat = service.genererArgumentaire({ ...prospectDeBase, ca: 250_000_000 });
    expect(resultat.regime).toBe('art47_arcom');
  });

  it('CA inconnu -> regime indetermine, avertissement explicite', () => {
    const resultat = service.genererArgumentaire({ ...prospectDeBase, ca: null });
    expect(resultat.regime).toBe('indetermine');
    expect(resultat.texte).toContain('CA inconnu');
  });

  it('ne presente jamais les montants art.47 (25000€/50000€) comme LA sanction pour un prospect EAA', () => {
    const resultat = service.genererArgumentaire({ ...prospectDeBase, ca: 5_000_000 });
    const paragrapheRegime = resultat.texte.split('\n\n')[0];
    // ces montants n'apparaissent legitimement que dans le rappel de fin
    // qui dit explicitement de ne pas les citer -- jamais dans le
    // paragraphe qui enonce LA sanction applicable a ce prospect
    expect(paragrapheRegime).not.toContain('25 000€');
    expect(paragrapheRegime).not.toContain('50 000€');
    expect(paragrapheRegime).toContain('7 500€');
  });
});
