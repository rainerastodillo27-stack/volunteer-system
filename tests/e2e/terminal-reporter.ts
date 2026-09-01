import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
  TestStep,
} from '@playwright/test/reporter';

const clock = () => new Date().toISOString().slice(11, 23);

export default class TerminalAuditReporter implements Reporter {
  onBegin(_config: FullConfig, suite: Suite) {
    console.log(`\n[${clock()}] Playwright live process audit: ${suite.allTests().length} tests`);
  }

  onTestBegin(test: TestCase) {
    console.log(`\n[${clock()}] TEST START  ${test.titlePath().slice(1).join(' > ')}`);
  }

  onStepBegin(_test: TestCase, _result: TestResult, step: TestStep) {
    if (step.category === 'hook') return;
    const prefix = step.category === 'test.step' ? 'PROCESS' : 'playwright';
    console.log(`  > [${clock()}] ${prefix}.${step.title}`);
  }

  onStepEnd(_test: TestCase, _result: TestResult, step: TestStep) {
    if (!step.error || step.category === 'hook') return;
    console.log(`  ! [${clock()}] FAILED ${step.title}: ${step.error.message?.split('\n')[0] || 'unknown error'}`);
  }

  onTestEnd(test: TestCase, result: TestResult) {
    console.log(`[${clock()}] TEST ${result.status.toUpperCase()} ${test.title} (${result.duration}ms)`);
  }

  onEnd(result: FullResult) {
    console.log(`\n[${clock()}] AUDIT COMPLETE: ${result.status.toUpperCase()}\n`);
  }
}
