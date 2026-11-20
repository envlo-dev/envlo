/**
 * Keywords that suggest a nearby token is an OTP / verification / device code.
 * Includes common EN + DE/FR/ES/PT/IT/NL/JA/KO/ZH/RU/PL/SV/… phrasings.
 */
export const OTP_CONTEXT_KEYWORDS: readonly string[] = [
  // English
  "otp",
  "2fa",
  "mfa",
  "totp",
  "code",
  "passcode",
  "password",
  "pin",
  "one-time",
  "onetime",
  "one time",
  "verification",
  "verification code",
  "verify",
  "authenticate",
  "authentication",
  "security code",
  "login code",
  "sign-in code",
  "signin code",
  "confirmation code",
  "access code",
  "temporary code",
  "device code",
  "user code",
  "your code",
  "enter this code",
  "use this code",
  "enter the code",
  "single-use",
  "challenge",
  // German
  "passwort",
  "bestätigungscode",
  "anmeldungscode",
  "sicherheitscode",
  "einmalcode",
  "einmalpasswort",
  "verifizierungscode",
  "zugangscode",
  // French
  "code de vérification",
  "code de verification",
  "vérification",
  "verification",
  "code à usage unique",
  "mot de passe",
  "code de connexion",
  "code de sécurité",
  // Spanish
  "código",
  "codigo",
  "código de verificación",
  "codigo de verificacion",
  "código de seguridad",
  "contraseña",
  "clave",
  "código de acceso",
  // Portuguese
  "código de verificação",
  "codigo de verificacao",
  "código de segurança",
  "senha",
  // Italian
  "codice",
  "codice di verifica",
  "codice di sicurezza",
  "codice di accesso",
  "password monouso",
  // Dutch
  "verificatiecode",
  "beveiligingscode",
  "eenmalige code",
  "inlogcode",
  // Swedish / Nordic
  "verifieringskod",
  "engångskod",
  "säkerhetskod",
  "bekreftelseskode",
  "engångspassord",
  // Polish
  "kod weryfikacyjny",
  "kod bezpieczeństwa",
  "hasło jednorazowe",
  // Russian (Cyrillic)
  "код",
  "код подтверждения",
  "одноразовый код",
  "код безопасности",
  // Japanese
  "認証コード",
  "確認コード",
  "セキュリティコード",
  "ワンタイムパスワード",
  "確認番号",
  // Korean
  "인증 코드",
  "인증코드",
  "확인 코드",
  "보안 코드",
  "일회용",
  // Chinese
  "验证码",
  "驗證碼",
  "校验码",
  "安全码",
  "一次性密码",
];

/** Positive signals in href / anchor text for verification / magic links. */
export const LINK_POSITIVE_KEYWORDS: readonly string[] = [
  "verify",
  "verification",
  "confirm",
  "confirmation",
  "activate",
  "activation",
  "token",
  "magic",
  "auth",
  "oauth",
  "login",
  "log-in",
  "signin",
  "sign-in",
  "sign_in",
  "signup",
  "sign-up",
  "sign_up",
  "register",
  "registration",
  "password",
  "reset",
  "otp",
  "2fa",
  "mfa",
  "challenge",
  "continue",
  "approve",
  "email-confirm",
  "email_confirm",
  "confirm-email",
  "confirm_email",
  "magic_link",
  "magic-link",
  "magiclink",
  "one-time",
  "onetime",
  "callback",
  "sso",
  // Locales (link CTAs)
  "vérifier",
  "confirmer",
  "activar",
  "verificar",
  "bestätigen",
  "anmelden",
  "確認",
  "認証",
  "验证",
  "확인",
];

/** Noise links that should not win as verificationUrl. */
export const LINK_NEGATIVE_KEYWORDS: readonly string[] = [
  "unsubscribe",
  "opt-out",
  "optout",
  "opt_out",
  "privacy",
  "preferences",
  "preference",
  "manage",
  "settings",
  "help",
  "support",
  "faq",
  "terms",
  "tos",
  "policy",
  "cookie",
  "facebook",
  "twitter",
  "x.com",
  "linkedin",
  "instagram",
  "youtube",
  "tiktok",
  "mailto:",
  "tel:",
  "social",
  "share",
  "tweet",
  "follow us",
  "cdn.",
  "static.",
  "tracking",
  "pixel",
  "beacon",
  "list-manage",
  "mailchimp",
  "abmelden",
  "désabonnement",
  "darse de baja",
  "cancelar inscrição",
];

/** Domains / host fragments that are almost never verification CTAs. */
export const LINK_NEGATIVE_HOST_FRAGMENTS: readonly string[] = [
  "facebook.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "instagram.com",
  "youtube.com",
  "tiktok.com",
  "wa.me",
  "t.me",
];

/**
 * Return the first matching keyword. Multi-word / CJK phrases use substring match;
 * Latin single tokens require Unicode word boundaries so `pin` does not hit `Shipping`.
 */
export function includesKeyword(haystack: string, keywords: readonly string[]): string | null {
  const lower = haystack.toLowerCase();
  for (const keyword of keywords) {
    const needle = keyword.toLowerCase();
    const isCjk = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(needle);
    if (isCjk || needle.includes(" ") || needle.includes("-")) {
      if (lower.includes(needle)) return keyword;
      continue;
    }
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped}(?:$|[^\\p{L}\\p{N}_])`, "u");
    if (re.test(lower)) return keyword;
  }
  return null;
}
