#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { join } from 'path';
import { ArgumentaireService } from '../a11y/argumentaire/argumentaire.service';

/**
 * Serveur MCP radar-signaux, en LECTURE SEULE (mode Dev + mode a11y).
 *
 * Decision actee le 01/08/2026 (memory/project_radar_signaux.md) : le
 * radar reste une app autonome (sa BDD, son cron, ses notifs -- il tourne
 * meme si Synapse n'existe pas), ce serveur MCP est juste une fenetre de
 * lecture dessus. Synapse est un simple client qui interroge a la
 * demande, il ne connait rien de la structure interne du radar au-dela
 * de ces 4 tools.
 *
 * Transport stdio (pas HTTP+token) : process local lance a la demande
 * par le client MCP (ex. Claude Code), pas de serveur permanent a
 * exposer, pas d'authentification necessaire (controle par l'OS, comme
 * n'importe quel process local). A reconsiderer seulement si Synapse a
 * besoin d'appeler le radar depuis autre chose qu'une session locale
 * (ex. routine cloud) -- pas le cas aujourd'hui.
 *
 * Volontairement decouple du reste de l'app NestJS (pas de DI, pas
 * d'import du module HTTP) : ce process tourne independamment, lit
 * directement le meme fichier SQLite en lecture seule. Seule
 * ArgumentaireService est reutilise (aucune dependance injectee, pas de
 * couplage NestJS reel malgre le decorateur @Injectable).
 */

const dbPath =
  process.env.RADAR_DB_PATH ?? join(process.cwd(), 'data', 'radar.sqlite');
if (!existsSync(dbPath)) {
  console.error(
    `radar-signaux MCP : base introuvable (${dbPath}). Lancer l'app au moins une fois pour la creer.`,
  );
  process.exit(1);
}
const db = new Database(dbPath, { readonly: true });

const argumentaire = new ArgumentaireService();

const server = new McpServer({ name: 'radar-signaux', version: '1.0.0' });

server.registerTool(
  'get_signals',
  {
    title: 'Signaux BODACC recents (mode Dev)',
    description:
      "Liste les signaux de modification de capital les plus recents (levees de fonds potentielles), avec enrichissement NAF/INPI/presse quand disponible. Rappel : le BODACC seul ne confirme ni le sens ni le montant d'une modification -- verifier les champs inpiCapital/acteSens avant toute conclusion.",
    inputSchema: { limite: z.number().int().min(1).max(200).optional() },
  },
  ({ limite }) => {
    const rows = db
      .prepare(
        `SELECT siren, date_parution as dateParution, commercant, tribunal,
                naf_code as nafCode, categorie_entreprise as categorieEntreprise,
                inpi_capital as inpiCapital, presse_confirmee as presseConfirmee,
                acte_sens as acteSens, acte_capital_avant as acteCapitalAvant,
                acte_capital_apres as acteCapitalApres
         FROM bodacc_signaux
         ORDER BY date_parution DESC
         LIMIT ?`,
      )
      .all(limite ?? 20);
    return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
  },
);

server.registerTool(
  'get_leads',
  {
    title: 'Prospects a11y qualifies (mode Freelance)',
    description:
      'Liste les prospects qualifies pour la prospection Nuada (>10 salaries, >2M€ CA, declaration RGAA absente/non conforme/partielle). Rappel : scan axe-core = accroche technique, pas une preuve de conformite a lui seul (couverture ~30-50%).',
    inputSchema: { limite: z.number().int().min(1).max(200).optional() },
  },
  ({ limite }) => {
    const rows = db
      .prepare(
        `SELECT domaine, siren, nom_complet as nomComplet, naf_code as nafCode, ca,
                statut_declaration as statutDeclaration,
                source_url_declaration as sourceUrlDeclaration,
                scan_total_violations as scanTotalViolations
         FROM a11y_prospects
         WHERE statut_qualification = 'qualifie'
           AND statut_declaration IN ('absente', 'non_conforme', 'partiel')
         ORDER BY traite_le DESC
         LIMIT ?`,
      )
      .all(limite ?? 20);
    return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
  },
);

server.registerTool(
  'search_company',
  {
    title: 'Recherche une entreprise dans les deux modes',
    description:
      'Cherche par nom, SIREN ou domaine dans les signaux mode Dev ET les prospects mode a11y. Utile pour verifier si une entreprise deja croisee ailleurs (ex. conseiller carriere) apparait dans le radar.',
    inputSchema: { requete: z.string().min(2) },
  },
  ({ requete }) => {
    const motif = `%${requete}%`;
    const signauxDev = db
      .prepare(
        `SELECT siren, commercant, date_parution as dateParution, naf_code as nafCode
         FROM bodacc_signaux
         WHERE commercant LIKE ? OR siren = ?
         ORDER BY date_parution DESC LIMIT 20`,
      )
      .all(motif, requete);
    const prospectsA11y = db
      .prepare(
        `SELECT domaine, siren, nom_complet as nomComplet, statut_declaration as statutDeclaration
         FROM a11y_prospects
         WHERE nom_complet LIKE ? OR siren = ? OR domaine LIKE ?
         ORDER BY traite_le DESC LIMIT 20`,
      )
      .all(motif, requete, motif);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { modeDev: signauxDev, modeA11y: prospectsA11y },
            null,
            2,
          ),
        },
      ],
    };
  },
);

server.registerTool(
  'get_argumentaire',
  {
    title: 'Argumentaire juridique pour un prospect a11y',
    description:
      'Genere la base factuelle (regime EAA/art.47 selon le CA reel, sanctions, constat, violations techniques) pour un domaine deja traite par le pipeline a11y. Pas un email pret a envoyer -- relecture humaine obligatoire avant tout contact.',
    inputSchema: { domaine: z.string().min(3) },
  },
  ({ domaine }) => {
    const row = db
      .prepare(
        `SELECT domaine, nom_complet as nomComplet, siren, naf_code as nafCode, ca,
                statut_declaration as statutDeclaration,
                source_url_declaration as sourceUrlDeclaration,
                scan_total_violations as scanTotalViolations,
                scan_top_violations as scanTopViolations
         FROM a11y_prospects
         WHERE domaine = ?`,
      )
      .get(domaine) as
      | {
          domaine: string;
          nomComplet: string | null;
          siren: string | null;
          nafCode: string | null;
          ca: number | null;
          statutDeclaration: string | null;
          sourceUrlDeclaration: string | null;
          scanTotalViolations: number | null;
          scanTopViolations: string | null;
        }
      | undefined;

    if (!row) {
      return {
        content: [
          {
            type: 'text',
            text: `Domaine ${domaine} pas encore traite par le pipeline a11y.`,
          },
        ],
        isError: true,
      };
    }

    const resultat = argumentaire.genererArgumentaire(row);
    return {
      content: [{ type: 'text', text: JSON.stringify(resultat, null, 2) }],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('radar-signaux MCP : erreur fatale', err);
  process.exit(1);
});
