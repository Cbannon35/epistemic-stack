"use client";

import { useActionState } from "react";
import { AuthForm } from "@/app/(auth)/auth-form";
import { Button } from "@/components/ui/button";
import { authenticate } from "../actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(authenticate, undefined);

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="font-semibold text-xl">epistemic-stack</h1>
          <p className="text-muted-foreground text-sm">
            Sign in to contribute to the commons.
          </p>
        </div>

        <AuthForm action={action}>
          {state?.error ? (
            <p className="text-destructive text-sm">{state.error}</p>
          ) : null}
          <div className="flex flex-col gap-2">
            <Button
              disabled={pending}
              name="intent"
              type="submit"
              value="signin"
            >
              {pending ? "Working…" : "Sign in"}
            </Button>
            <Button
              disabled={pending}
              name="intent"
              type="submit"
              value="signup"
              variant="outline"
            >
              Create account
            </Button>
          </div>
        </AuthForm>
      </div>
    </div>
  );
}
