import { Agent } from '@mastra/core/agent';
import { logger } from './logger.js';
import { runAgentStream } from './agent-runner.js';
import { selfValidate } from './agent-runner.js';
import { updateWorkflowState, createWorkflow } from './workflow-store.js';

// ── Types ──

export type WorkflowStep =
  | 'relevance'
  | 'discover'
  | 'negotiate_answers'
  | 'expectations'
  | 'suggest'
  | 'generate'
  | 'validate'
  | 'negotiate_fixes'
  | 'fix'
  | 'review'
  | 'done';

export interface WorkflowState {
  currentStep: WorkflowStep;
  sectionId: number;
  sectionName: string;
  answers: {
    applicable: boolean | null;
    discover: Record<string, string>;
    expectations: string;
    structureChoice: string;
  };
  negotiatedAnswers: Array<{
    questionId: string;
    question: string;
    suggested: string;
    accepted: boolean;
    modified?: string;
    final: string;
  }>;
  draft: string;
  revisionCount: number;
  findings: any[];
  negotiatedFixes: Array<{
    findingId: string;
    finding: string;
    proposedFix: string;
    autoFixable: boolean;
    accepted: boolean;
  }>;
  agentCalls: {
    orchestrator: number;
    writer: number;
    negotiator: number;
    validator: number;
  };
}

export interface WorkflowContext {
  workflowId: string;
  projectId: string;
  docId: string;
  stepId: number;
  sectionName?: string;
  sectionGuide: string;
  dependencySections: string[];
  inputDocuments: string[];
  qualityChecks: string[];
  userResponse?: any;
}

export interface WorkflowCallbacks {
  onStatus: (step: WorkflowStep, agent: string, message: string) => void;
  onToken: (delta: string) => void;
  onQuestion: (questions: string[], agent: string) => void;
  onSuggestions: (suggestions: any[], agent: string) => void;
  onOptions: (options: any[], agent: string) => void;
  onFixes: (fixes: any[], agent: string) => void;
  onReview: (sectionTitle: string, summary: any) => void;
  onFindings: (findings: any[]) => void;
  onPaused: (step: WorkflowStep, waitingFor: string) => Promise<void> | void;
  onDone: (tokensUsed: number) => void;
  onError: (error: string) => void;
}

interface AgentMap {
  orchestrator: Agent;
  writer: Agent;
  negotiator: Agent;
  validator: Agent;
}

// ── State Machine ──

export class BRSWorkflow {
  private agents: AgentMap;
  private state: WorkflowState;
  private context: WorkflowContext;
  private callbacks: WorkflowCallbacks;
  private maxRevisions = 3;

  constructor(agents: AgentMap, context: WorkflowContext, callbacks: WorkflowCallbacks) {
    this.agents = agents;
    // Suppress TS6133: agents are used indirectly by the callAgent helper.
    void this.agents;
    this.context = context;
    this.callbacks = callbacks;
    this.state = {
      currentStep: 'relevance',
      sectionId: context.stepId,
      sectionName: context.sectionName || '',
      answers: {
        applicable: null,
        discover: {},
        expectations: '',
        structureChoice: '',
      },
      negotiatedAnswers: [],
      draft: '',
      revisionCount: 0,
      findings: [],
      negotiatedFixes: [],
      agentCalls: {
        orchestrator: 0,
        writer: 0,
        negotiator: 0,
        validator: 0,
      },
    };
  }

  setCallbacks(callbacks: WorkflowCallbacks) {
    this.callbacks = callbacks;
  }

  getState(): WorkflowState {
    return this.state;
  }

  setState(state: WorkflowState) {
    this.state = state;
  }

  getContext(): WorkflowContext {
    return this.context;
  }

  // ── Main execution loop ──

  async run() {
    logger.info('Starting BRS workflow', {
      workflowId: this.context.workflowId,
      step: this.state.sectionId,
    });

    await createWorkflow(
      this.context.workflowId,
      this.context.projectId,
      this.context.docId,
      this.context.stepId,
      'brs-orchestrator',
      this.state,
    );

    try {
      await this.stepRelevance();
    } catch (err) {
      this.callbacks.onError((err as Error).message);
    }
  }

  // ── Resume after user input ──

  async resume(userResponse: any) {
    this.context.userResponse = userResponse;
    logger.info('Resuming BRS workflow', {
      workflowId: this.context.workflowId,
      step: this.state.currentStep,
      response: userResponse,
    });

    try {
      switch (this.state.currentStep) {
        case 'relevance':
          await this.handleRelevanceResponse();
          break;
        case 'discover':
          await this.handleDiscoverResponse();
          break;
        case 'negotiate_answers':
          await this.handleNegotiateAnswersResponse();
          break;
        case 'expectations':
          await this.handleExpectationsResponse();
          break;
        case 'suggest':
          await this.handleSuggestResponse();
          break;
        case 'negotiate_fixes':
          await this.handleNegotiateFixesResponse();
          break;
        case 'review':
          await this.handleReviewResponse();
          break;
        default:
          this.callbacks.onError(`Unknown step: ${this.state.currentStep}`);
      }
    } catch (err) {
      this.callbacks.onError((err as Error).message);
    }
  }

  // ── Persistence helper ──

  private async persist(status: 'active' | 'paused' | 'completed' | 'terminated' | 'error' = 'paused') {
    try {
      await updateWorkflowState(this.context.workflowId, this.state, status);
    } catch (err) {
      logger.error('failed to persist workflow state', {
        workflowId: this.context.workflowId,
        error: (err as Error).message,
      });
      // Don't throw; persistence is best-effort in this loop.
    }
  }

  private async pause(step: WorkflowStep, waitingFor: string) {
    this.state.currentStep = step;
    await this.persist('paused');
    await this.callbacks.onPaused(step, waitingFor);
  }

  // ── Step: Relevance Check ──

  private async stepRelevance() {
    this.state.currentStep = 'relevance';
    this.callbacks.onStatus('relevance', 'brs-orchestrator', 'Checking section relevance...');

    const questions = [
      `Section ${this.state.sectionId} is "${this.state.sectionName}". Is this section applicable to your BRS? (YES/NO)`,
    ];

    this.callbacks.onQuestion(questions, 'brs-orchestrator');
    await this.pause('relevance', 'user_answer');
  }

  private async handleRelevanceResponse() {
    const response = (this.context.userResponse || '').toString().toUpperCase().trim();

    if (response === 'NO' || response === 'N') {
      this.state.answers.applicable = false;
      await this.persist('terminated');
      this.callbacks.onStatus('done', 'brs-orchestrator', 'Section marked as NOT APPLICABLE');
      this.callbacks.onDone(0);
      return;
    }

    this.state.answers.applicable = true;
    this.callbacks.onStatus('discover', 'brs-orchestrator', 'Starting discovery...');
    await this.stepDiscover();
  }

  // ── Step: Discover (Writer asks questions) ──

  private async stepDiscover() {
    this.state.currentStep = 'discover';
    this.callbacks.onStatus('discover', 'brs-writer', 'Asking clarifying questions...');
    this.state.agentCalls.writer++;

    const prompt = this.buildDiscoverPrompt();
    const response = await this.callAgent('writer', prompt, false);
    const questions = this.parseQuestions(response);

    this.callbacks.onQuestion(questions, 'brs-writer');
    await this.pause('discover', 'user_answers');
  }

  private async handleDiscoverResponse() {
    const answers = this.context.userResponse || {};
    this.state.answers.discover = answers;

    this.callbacks.onStatus('negotiate_answers', 'brs-negotiator', 'Negotiating answers...');
    await this.stepNegotiateAnswers();
  }

  // ── Step: Negotiate Answers ──

  private async stepNegotiateAnswers() {
    this.state.currentStep = 'negotiate_answers';
    this.state.agentCalls.negotiator++;

    const prompt = this.buildNegotiateAnswersPrompt();
    const response = await this.callAgent('negotiator', prompt, false);
    const suggestions = this.parseSuggestions(response);

    this.callbacks.onSuggestions(suggestions, 'brs-negotiator');
    await this.pause('negotiate_answers', 'user_review_suggestions');
  }

  private async handleNegotiateAnswersResponse() {
    const reviewedAnswers = this.context.userResponse || [];
    this.state.negotiatedAnswers = reviewedAnswers;

    this.callbacks.onStatus('expectations', 'brs-orchestrator', 'Asking about expectations...');
    await this.stepExpectations();
  }

  // ── Step: Expectations ──

  private async stepExpectations() {
    this.state.currentStep = 'expectations';

    const questions = [
      'What are your specific expectations for this section?',
      'Any must-have content?',
      'Any specific constraints or preferences?',
    ];

    this.callbacks.onQuestion(questions, 'brs-orchestrator');
    await this.pause('expectations', 'user_expectations');
  }

  private async handleExpectationsResponse() {
    this.state.answers.expectations = (this.context.userResponse || '').toString();
    this.callbacks.onStatus('suggest', 'brs-writer', 'Suggesting structure options...');
    await this.stepSuggest();
  }

  // ── Step: Suggest ──

  private async stepSuggest() {
    this.state.currentStep = 'suggest';
    this.state.agentCalls.writer++;

    const prompt = this.buildSuggestPrompt();
    const response = await this.callAgent('writer', prompt, false);
    const options = this.parseOptions(response);

    this.callbacks.onOptions(options, 'brs-writer');
    await this.pause('suggest', 'user_structure_choice');
  }

  private async handleSuggestResponse() {
    this.state.answers.structureChoice = (this.context.userResponse || 'A').toString();
    this.callbacks.onStatus('generate', 'brs-writer', 'Generating section content...');
    await this.stepGenerate();
  }

  // ── Step: Generate ──

  private async stepGenerate() {
    this.state.currentStep = 'generate';
    this.state.agentCalls.writer++;

    const prompt = this.buildGeneratePrompt();
    const response = await this.callAgent('writer', prompt, true);
    this.state.draft = response;

    this.callbacks.onStatus('validate', 'brs-validator', 'Running quality checks...');
    await this.stepValidate();
  }

  // ── Step: Validate ──

  private async stepValidate() {
    this.state.currentStep = 'validate';
    this.state.agentCalls.validator++;

    const prompt = this.buildValidatePrompt();
    const response = await this.callAgent('validator', prompt, false);
    let findings = this.parseFindings(response);

    if (findings.length === 0) {
      findings = selfValidate(this.state.sectionId.toString(), this.state.sectionName, this.state.draft);
    }

    this.state.findings = findings;
    this.callbacks.onFindings(findings);

    const hasBlocking = findings.some((f: any) => f.type === 'BLOCKING');

    if (hasBlocking) {
      this.callbacks.onStatus('negotiate_fixes', 'brs-negotiator', 'Proposing fixes for findings...');
      await this.stepNegotiateFixes();
    } else {
      this.callbacks.onStatus('review', 'brs-orchestrator', 'Presenting draft for review...');
      await this.stepReview();
    }
  }

  // ── Step: Negotiate Fixes ──

  private async stepNegotiateFixes() {
    this.state.currentStep = 'negotiate_fixes';
    this.state.agentCalls.negotiator++;

    const prompt = this.buildNegotiateFixesPrompt();
    const response = await this.callAgent('negotiator', prompt, false);
    const fixes = this.parseFixes(response);

    this.state.negotiatedFixes = fixes;
    this.callbacks.onFixes(fixes, 'brs-negotiator');
    await this.pause('negotiate_fixes', 'user_review_fixes');
  }

  private async handleNegotiateFixesResponse() {
    const reviewedFixes = this.context.userResponse || [];
    this.state.negotiatedFixes = reviewedFixes;

    const hasAcceptedFixes = reviewedFixes.some((f: any) => f.accepted);

    if (hasAcceptedFixes) {
      this.callbacks.onStatus('fix', 'brs-writer', 'Applying fixes...');
      await this.stepFix();
    } else {
      this.callbacks.onStatus('review', 'brs-orchestrator', 'Presenting draft for review...');
      await this.stepReview();
    }
  }

  // ── Step: Fix ──

  private async stepFix() {
    this.state.currentStep = 'fix';
    this.state.agentCalls.writer++;

    const prompt = this.buildFixPrompt();
    const response = await this.callAgent('writer', prompt, true);
    this.state.draft = response;

    this.callbacks.onStatus('validate', 'brs-validator', 'Re-checking after fixes...');
    await this.stepValidate();
  }

  // ── Step: Review ──

  private async stepReview() {
    this.state.currentStep = 'review';

    const summary = {
      sectionId: this.state.sectionId,
      sectionName: this.state.sectionName,
      draftLength: this.state.draft.length,
      findingsCount: this.state.findings.length,
      revisionCount: this.state.revisionCount,
    };

    this.callbacks.onReview(`Section ${this.state.sectionId}: ${this.state.sectionName}`, summary);
    await this.pause('review', 'user_approval');
  }

  private async handleReviewResponse() {
    const response = this.context.userResponse || {};
    const action = (response.action || '').toString().toLowerCase();

    if (action === 'approve' || action === 'yes') {
      this.state.currentStep = 'done';
      await this.persist('completed');
      const tokensUsed =
        this.state.agentCalls.writer + this.state.agentCalls.negotiator + this.state.agentCalls.validator;
      this.callbacks.onStatus('done', 'brs-orchestrator', 'Section approved and locked');
      this.callbacks.onDone(tokensUsed);
    } else if (action === 'revise' || action === 'no') {
      this.state.revisionCount++;

      if (this.state.revisionCount >= this.maxRevisions) {
        await this.persist('paused');
        this.callbacks.onStatus(
          'review',
          'brs-orchestrator',
          `Maximum revisions (${this.maxRevisions}) reached. Please accept current version or skip section.`,
        );
        await this.pause('review', 'user_approval');
        return;
      }

      this.callbacks.onStatus(
        'generate',
        'brs-writer',
        `Revising (revision ${this.state.revisionCount}/${this.maxRevisions})...`,
      );
      await this.stepGenerate();
    } else {
      this.callbacks.onError(`Unknown review action: ${action}`);
    }
  }

  // ── Agent call helper ──

  private async callAgent(agentId: 'orchestrator' | 'writer' | 'negotiator' | 'validator', prompt: string, streamTokens: boolean): Promise<string> {
    
    const fullIdMap: Record<typeof agentId, string> = {
      orchestrator: 'brs-orchestrator',
      writer: 'brs-writer',
      negotiator: 'brs-negotiator',
      validator: 'brs-validator',
    };
    const fullId = fullIdMap[agentId];

    return new Promise((resolve, reject) => {
      let fullText = '';
      runAgentStream(
        {
          agentId: fullId,
          message: prompt,
          history: [],
        },
        {
          onToken: (delta) => {
            fullText += delta;
            
            if (streamTokens) {
              this.callbacks.onToken(delta);
            }
          },
          onDone: (tokensUsed) => {
            logger.debug('agent call complete', { agentId: fullId, tokensUsed });
            resolve(fullText);
          },
          onError: (error) => {
            logger.error('agent call failed', { agentId: fullId, error });
            reject(new Error(error));
          },
        },
      );
    });
  }

  // ── Prompt builders ──

  private buildDiscoverPrompt(): string {
    return [
      `You are generating Section ${this.state.sectionId} of a BRS document.`,
      `Section Guide:\n${this.context.sectionGuide}`,
      this.context.dependencySections.length > 0
        ? `Previously Approved Sections:\n${this.context.dependencySections.join('\n---\n')}`
        : '',
      this.context.inputDocuments.length > 0
        ? `Input Documents:\n${this.context.inputDocuments.join('\n---\n')}`
        : '',
      `Ask 3-5 clarifying questions to understand what content this section needs.`,
      `Return the questions as a numbered list.`,
    ]
      .filter(Boolean)
      .join('\n\n---\n\n');
  }

  private buildNegotiateAnswersPrompt(): string {
    return [
      `You are the Negotiator. The Writer asked these questions:`,
      JSON.stringify(this.state.answers.discover, null, 2),
      this.context.inputDocuments.length > 0
        ? `Input Documents:\n${this.context.inputDocuments.join('\n---\n')}`
        : '',
      `Propose answers for each question based on the problem statement and context.`,
      `Return JSON: {"suggestions": [{"questionId": "Q1", "question": "...", "suggestedAnswer": "...", "confidence": "high|medium|low"}]}.`,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private buildSuggestPrompt(): string {
    return [
      `You are generating Section ${this.state.sectionId}.`,
      `Suggest 2-3 structure options for this section.`,
      `Section Guide:\n${this.context.sectionGuide}`,
      `Return options as: Option A: <title> - <description>. Option B: ...`,
    ].join('\n\n---\n\n');
  }

  private buildGeneratePrompt(): string {
    return [
      `You are the BRS Writer. Generate Section ${this.state.sectionId}: ${this.state.sectionName}.`,
      `Section Guide:\n${this.context.sectionGuide}`,
      this.context.dependencySections.length > 0
        ? `Previously Approved Sections:\n${this.context.dependencySections.join('\n---\n')}`
        : '',
      this.context.inputDocuments.length > 0
        ? `Input Documents:\n${this.context.inputDocuments.join('\n---\n')}`
        : '',
      `User Answers:\n${JSON.stringify(this.state.negotiatedAnswers, null, 2)}`,
      `User Expectations:\n${this.state.answers.expectations}`,
      `Selected Structure: ${this.state.answers.structureChoice}`,
      `Generate the complete section content as Markdown. Use business language. Assign IDs where applicable. Output ONLY the Markdown content — no commentary.`,
    ]
      .filter(Boolean)
      .join('\n\n---\n\n');
  }

  private buildValidatePrompt(): string {
    return [
      `You are the BRS Validator. Validate the following section content:`,
      `Section ${this.state.sectionId}: ${this.state.sectionName}`,
      `Content:\n${this.state.draft}`,
      this.context.qualityChecks.length > 0 ? `Quality Checks:\n${this.context.qualityChecks.join('\n')}` : '',
      `Check for: forbidden terms (SHALL, API, database), missing subsections, MoSCoW priorities, traceability, placeholders.`,
      `Return findings as JSON: {"findings": [{"type": "BLOCKING|WARNING|INFO", "message": "...", "rule": "..."}]}.`,
    ]
      .filter(Boolean)
      .join('\n\n---\n\n');
  }

  private buildNegotiateFixesPrompt(): string {
    return [
      `You are the Negotiator. The Validator found these issues:`,
      JSON.stringify(this.state.findings, null, 2),
      `Propose fixes for each finding. For forbidden terms, suggest replacements. For missing items, suggest additions.`,
      `Return fixes as JSON: {"fixes": [{"findingId": "1", "proposedFix": "...", "autoFixable": true}]}.`,
    ].join('\n\n');
  }

  private buildFixPrompt(): string {
    return [
      `You are the BRS Writer. Apply these fixes to the section content:`,
      `Accepted Fixes:\n${JSON.stringify(this.state.negotiatedFixes.filter((f) => f.accepted), null, 2)}`,
      `Current Draft:\n${this.state.draft}`,
      `Regenerate the section with the fixes applied. Use business language. Keep IDs consistent.`,
    ].join('\n\n---\n\n');
  }

  // ── Parsers ──

  private parseQuestions(response: string): string[] {
    const lines = response.split('\n');
    const questions: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.match(/^\d+[\.\)]\s/) || trimmed.endsWith('?')) {
        questions.push(trimmed.replace(/^\d+[\.\)]\s*/, ''));
      }
    }
    if (questions.length > 0) return questions;
    return response ? [response.trim()] : [];
  }

  private parseSuggestions(response: string): any[] {
    const clean = this.extractJsonFromMarkdown(response);
    try {
      const parsed = JSON.parse(clean);
      return parsed.suggestions || [];
    } catch {
      return [{ questionId: 'Q1', question: 'General suggestion', suggestedAnswer: response.trim(), confidence: 'medium' }];
    }
  }

  private parseOptions(response: string): any[] {
    const options: any[] = [];
    const optionRegex = /(?:Option|option)\s+([A-C])[:\.]?\s*([^\n]+)/g;
    let match;
    while ((match = optionRegex.exec(response)) !== null) {
      options.push({ id: match[1], name: match[2].trim(), description: match[2].trim() });
    }
    return options.length > 0
      ? options
      : [{ id: 'A', name: 'Default Structure', description: 'Use the default structure from the section guide' }];
  }

  private parseFindings(response: string): any[] {
    const clean = this.extractJsonFromMarkdown(response);
    try {
      const parsed = JSON.parse(clean);
      return parsed.findings || [];
    } catch {
      const findings: any[] = [];
      const lines = response.split('\n');
      for (const line of lines) {
        if (line.includes('BLOCKING') || line.includes('WARNING') || line.includes('INFO')) {
          const type = line.includes('BLOCKING') ? 'BLOCKING' : line.includes('WARNING') ? 'WARNING' : 'INFO';
          findings.push({ type, message: line.trim(), rule: 'unknown' });
        }
      }
      return findings;
    }
  }

  private parseFixes(response: string): any[] {
    const clean = this.extractJsonFromMarkdown(response);
    try {
      const parsed = JSON.parse(clean);
      return parsed.fixes || [];
    } catch {
      return [];
    }
  }

  private extractJsonFromMarkdown(response: string): string {
    const codeBlock = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlock && codeBlock[1]) {
      return codeBlock[1].trim();
    }
    return response.trim();
  }
}
