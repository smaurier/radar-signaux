import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createTransport, Transporter } from 'nodemailer';
import { A11yStorageService } from '../storage/a11y-storage.service';

interface ViolationResume {
  id: string;
  impact: string | null;
  nombreOccurrences: number;
}

interface ProspectNotifie {
  domaine: string;
  siren: string | null;
  nomComplet: string | null;
  nafCode: string | null;
  ca: number | null;
  statutDeclaration: string;
  sourceUrlDeclaration: string | null;
  scanTotalViolations: number | null;
  scanTopViolations: string | null;
}

/**
 * Digest email quotidien des nouveaux prospects a11y qualifies (meme
 * mecanisme que NotificationsService du mode Dev, credentials Gmail
 * partagees, creneau cron different pour ne pas se chevaucher).
 *
 * Rappel systematique dans le mail : axe-core ne couvre que ~30-50% des
 * violations reelles, jamais une preuve de conformite a elle seule --
 * seule la propre declaration RGAA du site (deja lue) fait foi.
 */
@Injectable()
export class A11yNotificationsService {
  private readonly logger = new Logger(A11yNotificationsService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly storage: A11yStorageService) {}

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    if (!user || !pass) {
      throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD manquants (.env).');
    }
    this.transporter = createTransport({ service: 'gmail', auth: { user, pass } });
    return this.transporter;
  }

  // 8h, apres le cron du pipeline a11y (7h45) -- laisse le temps au lot du
  // jour de se terminer avant d'envoyer le digest.
  @Cron('0 8 * * *')
  async runDaily(): Promise<void> {
    await this.run();
  }

  async run(): Promise<number> {
    const prospects = this.storage.listerNonNotifies() as ProspectNotifie[];
    if (prospects.length === 0) {
      this.logger.log('Notifications a11y : rien de nouveau a envoyer.');
      return 0;
    }

    const to = process.env.RADAR_NOTIFY_TO ?? process.env.GMAIL_USER;
    if (!to) throw new Error('RADAR_NOTIFY_TO (ou GMAIL_USER) manquant (.env).');

    const transporter = this.getTransporter();
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to,
      subject: `radar-signaux a11y : ${prospects.length} prospect(s) qualifie(s)`,
      text: this.buildTextBody(prospects),
      html: this.buildHtmlBody(prospects),
    });

    this.storage.marquerNotifies(prospects.map((p) => p.domaine));
    this.logger.log(`Notifications a11y : digest envoye (${prospects.length} prospect(s)).`);
    return prospects.length;
  }

  private descriptionProspect(p: ProspectNotifie): string {
    const violations = this.topViolationsResumees(p.scanTopViolations);
    const parts = [
      p.nafCode ? `NAF ${p.nafCode}` : null,
      typeof p.ca === 'number' ? `CA ${p.ca.toLocaleString('fr-FR')} €` : null,
      `déclaration : ${p.statutDeclaration}`,
      violations,
    ].filter(Boolean);
    return parts.join(', ');
  }

  private topViolationsResumees(json: string | null): string | null {
    if (!json) return null;
    try {
      const violations = JSON.parse(json) as ViolationResume[];
      if (violations.length === 0) return null;
      const top = violations
        .slice(0, 3)
        .map((v) => `${v.id} (${v.impact}, ${v.nombreOccurrences}x)`)
        .join(' / ');
      return `top violations axe : ${top}`;
    } catch {
      return null;
    }
  }

  private buildTextBody(prospects: ProspectNotifie[]): string {
    const lignes = prospects.map(
      (p) =>
        `- ${p.nomComplet ?? p.domaine} (${p.domaine}, SIREN ${p.siren}) — ${this.descriptionProspect(p)}`,
    );
    return [
      `${prospects.length} prospect(s) qualifie(s) (>10 salaries, >2M€ CA) sans declaration RGAA conforme :`,
      '',
      ...lignes,
      '',
      "Rappel : axe-core ne couvre qu'une partie des violations reelles (~30-50%), ce n'est jamais",
      "une preuve de conformite a lui seul -- seule la declaration RGAA du site (deja lue) fait foi.",
      "Verifier manuellement avant toute prise de contact.",
    ].join('\n');
  }

  private buildHtmlBody(prospects: ProspectNotifie[]): string {
    const lignes = prospects
      .map(
        (p) =>
          `<li><strong>${p.nomComplet ?? p.domaine}</strong> (${p.domaine}, SIREN ${p.siren})<br><small>${this.descriptionProspect(p)}</small></li>`,
      )
      .join('\n');
    return `<p>${prospects.length} prospect(s) qualifie(s) (&gt;10 salariés, &gt;2M€ CA) sans déclaration RGAA conforme :</p>
      <ul>${lignes}</ul>
      <p><small>Rappel : axe-core ne couvre qu'une partie des violations réelles (~30-50%), ce n'est jamais
      une preuve de conformité à lui seul — seule la déclaration RGAA du site (déjà lue) fait foi.
      Vérifier manuellement avant toute prise de contact.</small></p>`;
  }
}
