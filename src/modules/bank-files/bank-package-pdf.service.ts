import { Injectable } from '@nestjs/common';
import { formatRwfLabel } from '../../common/money/money-format.util';
import { HtmlToPdfService } from '../../common/pdf/html-to-pdf.service';

export type BankPackageItemContext = {
  code: string;
  label: string;
  source: string;
  present: boolean;
  documentUrl: string | null;
  generatedAt: Date | null;
  uploadedAt: Date | null;
  verifiedAt: Date | null;
};

export type BankPackageAuditEntry = {
  at: Date;
  actor: string | null;
  kind: string;
  detail: string | null;
};

export type BankPackageRenderContext = {
  reference: string;
  version: number;
  status: string;
  lenderName: string;
  applicantName: string;
  applicantUzaId: string;
  productRef: string;
  allocationRef: string | null;
  pricePaidRwf: bigint | null;
  contributionRwf: bigint | null;
  insuranceRwf: bigint | null;
  financedAmountRwf: bigint | null;
  tenorMonths: number | null;
  submittedAt: Date | null;
  items: BankPackageItemContext[];
  audit: BankPackageAuditEntry[];
  generatedByName: string;
};

/**
 * Renders the bank-ready file package as HTML, then to PDF via the same
 * `HtmlToPdfService` (Puppeteer) every other generated document in this codebase already
 * uses — `InvoicePdfService`, `FleetRequestPdfService`, `QuotePdfService`. Project
 * Harmony's prototype for this used pdf-lib; this repo already solved "how do we render
 * a document" with its own convention, and duplicating a second rendering stack for one
 * more document type is exactly the kind of local reinvention `CLAUDE.md`'s contracts
 * rule warns against — so this follows the existing one instead.
 *
 * Four sections, matching what Project Harmony's package covers: a cover page (applicant
 * + loan figures), the document checklist with each item's real status, the audit trail,
 * and a two-signature sign-off block.
 */
@Injectable()
export class BankPackagePdfService {
  constructor(private readonly htmlToPdf: HtmlToPdfService) {}

  async render(context: BankPackageRenderContext): Promise<Buffer> {
    const html = this.renderHtml(context);
    return this.htmlToPdf.render(html);
  }

  private renderHtml(ctx: BankPackageRenderContext): string {
    const money = (v: bigint | null) =>
      v === null ? '—' : formatRwfLabel(Number(v));
    const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '—');

    const itemRows = ctx.items
      .map((item) => {
        const detail = item.documentUrl
          ? `${this.escapeHtml(item.documentUrl)}${item.uploadedAt ? ` · ${day(item.uploadedAt)}` : ''}`
          : item.generatedAt
            ? `Generated ${day(item.generatedAt)}`
            : 'Not yet received';
        const status = item.present
          ? item.verifiedAt
            ? 'Verified'
            : 'Received'
          : 'Missing';
        const statusClass = item.present ? 'ok' : 'missing';
        return `<tr>
          <td>${this.escapeHtml(item.label)}<div class="muted small">${this.escapeHtml(item.code)}</div></td>
          <td>${this.escapeHtml(item.source)}</td>
          <td>${detail}</td>
          <td class="${statusClass}">${status}</td>
        </tr>`;
      })
      .join('\n');

    const auditRows = ctx.audit.length
      ? ctx.audit
          .map(
            (entry) => `<tr>
          <td>${day(entry.at)}</td>
          <td>${this.escapeHtml(entry.kind.replace(/_/g, ' '))}</td>
          <td>${this.escapeHtml(entry.actor ?? 'system')}</td>
          <td>${this.escapeHtml(entry.detail ?? '')}</td>
        </tr>`,
          )
          .join('\n')
      : '<tr><td colspan="4" class="muted">No recorded activity yet.</td></tr>';

    const requiredTotal = ctx.items.length;
    const requiredDone = ctx.items.filter((i) => i.present).length;

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${this.escapeHtml(ctx.reference)} — bank package</title>
  <style>
    body { font-family: Arial, sans-serif; color: #151515; margin: 32px; font-size: 12.5px; }
    h1 { color: #174438; margin: 0; font-size: 20px; }
    h2 { color: #174438; font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid #e9e9e9; padding-bottom: 6px; margin: 24px 0 10px; }
    .muted { color: #356769; }
    .small { font-size: 10px; }
    .header { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 8px; align-items: flex-start; }
    .badge { display: inline-block; background: #174438; color: #fff; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; padding: 4px 10px; border-radius: 999px; margin-bottom: 8px; text-transform: uppercase; }
    .box { border: 1px solid #e9e9e9; border-radius: 8px; padding: 14px 16px; margin-bottom: 14px; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; }
    th, td { border: 1px solid #e9e9e9; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f8faf9; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; color: #356769; }
    td.ok { color: #1c7a3d; font-weight: 600; }
    td.missing { color: #b23b3b; font-weight: 600; }
    .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .sig { display: flex; gap: 32px; margin-top: 28px; }
    .sig-line { flex: 1; border-top: 1px solid #999; padding-top: 6px; font-size: 11px; color: #356769; }
    .footer { margin-top: 24px; font-size: 11px; color: #356769; display: flex; justify-content: space-between; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <strong>UZA MOBILITY</strong>
      <div class="muted" style="margin-top: 6px">Kigali, Rwanda</div>
    </div>
    <div style="text-align:right">
      <div class="badge">Bank-ready file package</div>
      <h1>${this.escapeHtml(ctx.reference)} — v${ctx.version}</h1>
      <div>Prepared for ${this.escapeHtml(ctx.lenderName)}</div>
      <div>Generated ${day(new Date())}</div>
    </div>
  </div>

  <h2>Applicant and file</h2>
  <div class="box cols">
    <div>
      <strong>${this.escapeHtml(ctx.applicantName)}</strong><br/>
      UZA ID: ${this.escapeHtml(ctx.applicantUzaId)}<br/>
      File status: ${this.escapeHtml(ctx.status)}<br/>
      Submitted: ${day(ctx.submittedAt)}
    </div>
    <div>
      Product: ${this.escapeHtml(ctx.productRef)}<br/>
      Allocated unit: ${ctx.allocationRef ? this.escapeHtml(ctx.allocationRef) : 'To be confirmed'}<br/>
      Tenor: ${ctx.tenorMonths ? `${ctx.tenorMonths} months` : '—'}
    </div>
  </div>

  <h2>Loan and asset figures</h2>
  <table>
    <tbody>
      <tr><th>Vehicle price paid</th><td>${money(ctx.pricePaidRwf)}</td></tr>
      <tr><th>Client contribution</th><td>${money(ctx.contributionRwf)}</td></tr>
      <tr><th>Insurance</th><td>${money(ctx.insuranceRwf)}</td></tr>
      <tr><th>Financed amount</th><td>${money(ctx.financedAmountRwf)}</td></tr>
    </tbody>
  </table>

  <h2>Document checklist — ${requiredDone} of ${requiredTotal} received</h2>
  <table>
    <thead>
      <tr><th>Document</th><th>Source</th><th>Detail</th><th>Status</th></tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
  </table>

  <h2>Audit trail</h2>
  <table>
    <thead>
      <tr><th>Date</th><th>Event</th><th>Actor</th><th>Detail</th></tr>
    </thead>
    <tbody>
      ${auditRows}
    </tbody>
  </table>

  <h2>Sign-off</h2>
  <p>Prepared by ${this.escapeHtml(ctx.generatedByName)} (UZA Mobility).</p>
  <div class="sig">
    <div class="sig-line">UZA advisor — name, signature, date</div>
    <div class="sig-line">${this.escapeHtml(ctx.lenderName)} officer — name, signature, date</div>
  </div>

  <div class="footer">
    <span>UZA Mobility · ${this.escapeHtml(ctx.reference)} · version ${ctx.version}</span>
    <span>Generated automatically — contact our team for questions.</span>
  </div>
</body>
</html>`;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
