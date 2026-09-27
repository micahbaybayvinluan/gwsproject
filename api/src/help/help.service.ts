import { HttpException, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import type { SessionUser } from '../common/request-context';
import { ROLE_BY_KEY } from '../common/permissions';
import { Guide, GuideSection, loadGuideFile, parseGuide, roleGuideFor, searchSections, sectionsFor } from './guide';

export interface AskTurn { role: 'user' | 'assistant'; content: string }
export interface AskResult { mode: 'ai' | 'guide'; answer: string | null; note?: string; sections: GuideSection[] }

const INSTRUCTIONS = `You are the help assistant inside GWS-ERP, the internal system of Get Wheysted Supplements (a Philippine supplement retailer with branches, a warehouse and franchises).
Answer questions about how to use GWS-ERP, using only the user guide below. Staff may write in English, Filipino or Taglish; answer in the language they used.

How to answer:
- Give the exact menu names and button labels from the guide, as short numbered steps when there are steps.
- Answer for the asker's role (given after the guide). If their role cannot do what they ask, say so plainly and say which role can.
- If the guide does not cover the question, say you are not sure and suggest asking Admin. Do not invent screens, buttons or rules.
- You cannot see or change any data (sales, stock, prices, costs, pay). If asked for figures, explain where in the system they can look.
- Never reveal supplier cost rules beyond what the guide says, and stay on the topic of using the system.
- Keep answers short: usually under 150 words.

<user_guide>
`;

/**
 * "Help & Guide" (owner request 2026-09-26): the written user guide filtered to the person's role, keyword search, and an
 * optional AI assistant (Claude) that answers from the same guide when ANTHROPIC_API_KEY is set. Only the question, the
 * guide and the person's role are sent to the AI; no business data.
 */
@Injectable()
export class HelpService {
  private log = new Logger('Help');
  private guide: Guide | null = null;
  private client: Anthropic | null = null;
  private asked = new Map<string, number[]>();

  private roles: Guide | null = null;
  private load(): Guide { if (!this.guide || process.env.NODE_ENV !== 'production') this.guide = parseGuide(loadGuideFile()); return this.guide; }
  private loadRoles(): Guide { if (!this.roles || process.env.NODE_ENV !== 'production') this.roles = parseGuide(loadGuideFile('ROLE-GUIDES.md')); return this.roles; }
  aiEnabled() { return !!process.env.ANTHROPIC_API_KEY?.trim(); }

  sections(user: SessionUser) {
    const g = this.load();
    const mine = sectionsFor(g, user.permissions); const rg = this.loadRoles();
    return {
      intro: g.intro, aiEnabled: this.aiEnabled(), role: ROLE_BY_KEY[user.roleKey]?.name ?? user.roleKey,
      // step-by-step guide for this person's role, the processes everyone uses, and the other topics their permissions open
      roleGuide: roleGuideFor(rg, user.roleKey),
      everyone: mine.filter((x) => x.roles === 'all'),
      topics: mine.filter((x) => x.roles !== 'all'),
      // the Owner trains staff, so sees every role's guide
      allRoleGuides: user.roleKey === 'ADMIN' ? rg.sections : undefined,
      sections: mine,
    };
  }

  /** At most HELP_AI_PER_HOUR questions per person per hour (default 30) to keep the AI bill predictable. */
  private allow(userId: string) {
    const limit = Number(process.env.HELP_AI_PER_HOUR || 30); const now = Date.now();
    const recent = (this.asked.get(userId) ?? []).filter((t) => now - t < 3600000);
    if (recent.length >= limit) return false;
    recent.push(now); this.asked.set(userId, recent); return true;
  }

  async ask(question: string, history: AskTurn[], user: SessionUser): Promise<AskResult> {
    const g = this.load();
    const mine = sectionsFor(g, user.permissions);
    const related = searchSections(mine, question, 3);
    if (!this.aiEnabled()) return { mode: 'guide', answer: null, sections: related, note: related.length ? undefined : 'No guide section matched. Try other words, or browse the sections below.' };
    if (!this.allow(user.id)) return { mode: 'guide', answer: null, sections: related, note: 'You have asked many questions this hour; here are the matching guide sections instead.' };

    const role = ROLE_BY_KEY[user.roleKey];
    const guideText = [...g.sections.map((s) => `## ${s.title}\n(for: ${s.roles === 'all' ? 'everyone' : s.roles.join(', ')})\n${s.body}`), ...this.loadRoles().sections.map((s) => `## Role guide: ${s.title}\n(for role: ${(s.roleKeys ?? []).join(', ')})\n${s.body}`)].join('\n\n');
    this.client ??= new Anthropic();
    try {
      const response = await this.client.beta.messages.create({
        model: process.env.HELP_AI_MODEL || 'claude-opus-5',
        max_tokens: 16000,
        output_config: { effort: 'medium' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: [
          // the instructions and the whole guide are identical for everyone, so they are cached; the role comes after
          { type: 'text', text: `${INSTRUCTIONS}${guideText}\n</user_guide>`, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: `The person asking is ${user.fullName}, role: ${role?.name ?? user.roleKey} (${role?.description ?? ''}). Their permissions: ${[...user.permissions].sort().join(', ')}. Sections of the guide that apply to them: ${mine.map((s) => s.title).join('; ')}.` },
        ],
        messages: [...history.slice(-6).map((t) => ({ role: t.role, content: t.content })), { role: 'user', content: question }],
      });
      if (response.stop_reason === 'refusal') return { mode: 'guide', answer: null, sections: related, note: 'The assistant could not answer that. Here are the matching guide sections.' };
      const answer = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim();
      return { mode: 'ai', answer: answer || null, sections: related };
    } catch (e) {
      const why = e instanceof Anthropic.AuthenticationError ? 'The AI key in api/.env is not valid (ask Admin).'
        : e instanceof Anthropic.RateLimitError ? 'The AI service is busy right now; try again in a minute.'
        : e instanceof Anthropic.APIConnectionError ? 'The AI service could not be reached (check the internet connection).'
        : e instanceof Anthropic.APIError ? `The AI service returned an error (${e.status}).`
        : 'The AI assistant is not available right now.';
      this.log.warn(`Help AI failed: ${(e as Error).message}`);
      if (e instanceof HttpException) throw e;
      return { mode: 'guide', answer: null, sections: related, note: `${why} Here are the matching guide sections.` };
    }
  }
}
