import Link from "next/link";
import { DocPage } from "@/components/docs/doc-page";
import { NextReads, Sample } from "@/components/docs/doc-parts";
import { Callout } from "@/components/ui/feedback";

export const metadata = { title: "Failure scenarios" };

export default function ScenariosPage() {
  return (
    <DocPage
      title="Failure scenarios"
      lede="How TraceCI behaves on each kind of CI failure, what a healthy run looks like, and where it tends to struggle. Use this to calibrate what you are seeing."
    >
      <h2 id="regression">A regression the log does not name</h2>
      <p>
        <strong>Shape:</strong> a test fails with an error about a value it did not construct. The
        traceback names the test file; the bug is somewhere else.
      </p>
      <Sample>
        {`E       AttributeError: 'dict' object has no attribute 'expires_at'
tests/unit/test_auth.py:47: AttributeError`}
      </Sample>
      <p>
        <strong>Healthy run:</strong> one <code>read_file</code> on the module that produces the
        value, then a diagnosis naming the function and the changed return type. Confidence 8–9.
      </p>
      <p>
        <strong>Why this is the interesting case:</strong> a script cannot do it. Everything in the
        log is true and none of it is the answer. This is the case the tool budget and the
        &ldquo;open the source&rdquo; instinct exist for.
      </p>

      <h2 id="dependency">A dependency that will not resolve</h2>
      <p>
        <strong>Shape:</strong> the build fails during installation. The resolver prints the
        conflicting constraints in full.
      </p>
      <Sample>
        {`ERROR: Cannot install app==1.4.0 and urllib3<2 because these have conflicting dependencies.
The conflict is caused by:
    The user requested urllib3<2
    botocore 1.34.2 depends on urllib3>=2.0.7`}
      </Sample>
      <p>
        <strong>Healthy run: zero tool calls.</strong> The log contains the answer verbatim, so
        opening <code>requirements.txt</code> to confirm it wastes a turn and adds nothing. A run
        that reads three files here is a run that has been trained to look busy.
      </p>
      <p>
        <strong>Watch for:</strong> the fix suggestion is often the weakest part. Pinning{" "}
        <code>urllib3</code> resolves the build; whether it is what you should do depends on
        constraints TraceCI cannot see.
      </p>

      <h2 id="config">A broken workflow or tooling config</h2>
      <p>
        <strong>Shape:</strong> failure at a setup step — <code>Set up Python</code>,{" "}
        <code>actions/cache</code>, a matrix expansion. Nothing has run yet, and the application
        code is irrelevant.
      </p>
      <p>
        <strong>Healthy run:</strong> a <code>read_file</code> on the workflow file, sometimes a{" "}
        <code>list_directory</code> to confirm a path exists. Category <code>config</code>, and the
        root cause names the YAML key.
      </p>
      <p>
        <strong>Watch for:</strong> workflow files that use reusable workflows or composite actions
        defined in other repositories. TraceCI reads the repository under investigation, so a
        failure inside an external action is visible only through its output.
      </p>

      <h2 id="lint">A lint or type error</h2>
      <p>
        <strong>Shape:</strong> a static check rejected the code. Rule code, file and line are
        printed together.
      </p>
      <Sample>
        {`app/rate_limit.py:64:9: F821 undefined name 'window_start'
Found 1 error.`}
      </Sample>
      <p>
        <strong>Healthy run:</strong> zero or one tool calls, high confidence, and a patch that is
        usually correct — this is the category where the suggested fix is most reliable, because
        the tool already stated exactly what it wanted.
      </p>
      <p>
        <strong>Watch for:</strong> a lint failure after a configuration change. The error is in
        your code but the <em>cause</em> is a new rule being enabled, and that distinction is only
        visible in the diff.
      </p>

      <h2 id="infra">Infrastructure</h2>
      <p>
        <strong>Shape:</strong> runner out of disk, a registry timeout, a service container that
        never became healthy, a cancelled job. Nothing to do with your change.
      </p>
      <p>
        <strong>Healthy run:</strong> zero tool calls and a category of <code>infra</code>. This is
        the one category where re-running the job is a legitimate response.
      </p>
      <p>
        <strong>Watch for:</strong> infrastructure failures that are really resource regressions. A
        job that started running out of memory after a change is categorised as infra but caused by
        the diff — check whether the diff is empty before accepting the label.
      </p>

      <h2 id="flaky">Flakiness</h2>
      <p>
        <strong>Shape:</strong> a test that passes on re-run. Timing, ordering or shared state.
      </p>
      <p>
        <strong>Healthy run:</strong> confidence in the 4–6 range, and language that says the
        failure is consistent with non-determinism rather than asserting it. A single run cannot
        prove flakiness, and a diagnosis claiming it at confidence 9 is overreaching.
      </p>
      <p>
        <strong>Best use:</strong> run TraceCI on the failed run rather than re-running the job. It
        often identifies the shared fixture or ordering assumption, which a green re-run destroys
        the evidence for.
      </p>

      <Callout tone="warn" title="Multiple simultaneous failures">
        When several unrelated things break in one run, TraceCI diagnoses the first failing step
        and says so. It does not produce a list of independent root causes. If the run has two
        distinct failures, investigate the second one separately once the first is fixed.
      </Callout>

      <h2 id="calibration">Quick calibration table</h2>
      <table>
        <thead>
          <tr>
            <th>Scenario</th>
            <th>Expected tool calls</th>
            <th>Expected confidence</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Regression the log does not name</td>
            <td>1–2</td>
            <td>8–9</td>
          </tr>
          <tr>
            <td>Dependency conflict</td>
            <td>0</td>
            <td>8–10</td>
          </tr>
          <tr>
            <td>Workflow / tooling config</td>
            <td>1</td>
            <td>7–9</td>
          </tr>
          <tr>
            <td>Lint or type error</td>
            <td>0–1</td>
            <td>9–10</td>
          </tr>
          <tr>
            <td>Infrastructure</td>
            <td>0</td>
            <td>6–8</td>
          </tr>
          <tr>
            <td>Flaky test</td>
            <td>1–2</td>
            <td>4–6</td>
          </tr>
        </tbody>
      </table>
      <p>
        These are expectations, not guarantees. A run well outside its row is worth a second look —
        not because it is necessarily wrong, but because it is unusual.
      </p>

      <NextReads
        items={[
          {
            href: "/docs/guides/best-practices",
            title: "Best practices",
            note: "Getting more of the healthy runs above.",
          },
          {
            href: "/docs/limitations",
            title: "Limitations",
            note: "Scenarios where none of this applies.",
          },
        ]}
      />
      <p className="mt-6">
        Each scenario has a matching branch in the lab repository, prefilled as an example in the{" "}
        <Link href="/investigate">workspace</Link>.
      </p>
    </DocPage>
  );
}
