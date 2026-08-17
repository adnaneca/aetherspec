import type { ServerResponse } from "node:http";
import type { WorkflowCallbacks, WorkflowStep } from "./workflow.js";

export function createSSECallbacks(res: ServerResponse): WorkflowCallbacks {
  let ended = false;

  function safeWrite(data: string) {
    if (!ended && !res.writableEnded) {
      res.write(data);
    }
  }

  function safeEnd() {
    if (!ended && !res.writableEnded) {
      ended = true;
      res.end();
    }
  }

  // Prevent Node HTTP socket timeout on long-running agent calls.
  if (res.socket) {
    res.socket.setTimeout(0);
    res.socket.setNoDelay(true);
  }

  return {
    onStatus: (step: WorkflowStep, agent: string, message: string) => {
      safeWrite(
        `data: ${JSON.stringify({ type: "status", step, agent, message })}\n\n`,
      );
    },
    onToken: (delta: string) => {
      safeWrite(`data: ${JSON.stringify({ type: "token", delta })}\n\n`);
    },
    onQuestion: (questions: string[], agent: string) => {
      safeWrite(
        `data: ${JSON.stringify({ type: "question", agent, questions })}\n\n`,
      );
    },
    onSuggestions: (suggestions: any[], agent: string) => {
      safeWrite(
        `data: ${JSON.stringify({ type: "suggestions", agent, suggestions })}\n\n`,
      );
    },
    onOptions: (options: any[], agent: string) => {
      safeWrite(
        `data: ${JSON.stringify({ type: "options", agent, options })}\n\n`,
      );
    },
    onFixes: (fixes: any[], agent: string) => {
      safeWrite(`data: ${JSON.stringify({ type: "fixes", agent, fixes })}\n\n`);
    },
    onReview: (sectionTitle: string, summary: any) => {
      safeWrite(
        `data: ${JSON.stringify({ type: "review", sectionTitle, summary })}\n\n`,
      );
    },
    onFindings: (findings: any[]) => {
      safeWrite(`data: ${JSON.stringify({ type: "findings", findings })}\n\n`);
    },
    onFindingsRaw: (findings: any[], agent: string) => {
      safeWrite(
        `data: ${JSON.stringify({ type: "findings_raw", findings, agent })}\n\n`,
      );
    },
    onPaused: async (step: WorkflowStep, waitingFor: string) => {
      safeWrite(
        `data: ${JSON.stringify({ type: "paused", step, waitingFor })}\n\n`,
      );
      safeEnd();
    },
    onDone: (tokensUsed: number) => {
      safeWrite(`data: ${JSON.stringify({ type: "done", tokensUsed })}\n\n`);
      safeEnd();
    },
    onError: (error: string) => {
      safeWrite(`data: ${JSON.stringify({ type: "error", error })}\n\n`);
      safeEnd();
    },
  };
}
