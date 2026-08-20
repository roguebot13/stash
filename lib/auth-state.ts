export type AuthActionState = {
  status: "idle" | "error" | "success";
  message?: string;
  values?: { email?: string };
  errors?: Partial<Record<"email" | "password" | "confirmPassword" | "token", string[]>>;
};

export const initialAuthActionState: AuthActionState = { status: "idle" };
