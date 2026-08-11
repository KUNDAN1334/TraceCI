import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-20 sm:px-6">
      <EmptyState
        title="That page does not exist"
        description="The link may be out of date. Everything TraceCI can do is reachable from the workspace or the documentation."
        action={
          <>
            <ButtonLink href="/investigate" variant="primary" size="sm">
              Go to the workspace
            </ButtonLink>
            <ButtonLink href="/docs" size="sm">
              Read the docs
            </ButtonLink>
          </>
        }
      />
    </div>
  );
}
