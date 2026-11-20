import { describe, expect, it } from "vitest";
import {
  extractOtpCandidates,
  normalizeAuthCode,
  pickBestOtp,
} from "../../src/extract/index.js";

describe("extractOtpCandidates", () => {
  it("extracts classic 6-digit codes near verification keywords", () => {
    expect(pickBestOtp(extractOtpCandidates("Your verification code is 482913."))).toBe(
      "482913",
    );
  });

  it("extracts 4- and 8-digit OTPs", () => {
    expect(pickBestOtp(extractOtpCandidates("Enter this login code: 7391"))).toBe("7391");
    expect(pickBestOtp(extractOtpCandidates("Your one-time passcode is 19283746."))).toBe(
      "19283746",
    );
  });

  it("extracts longer numeric codes when context is present", () => {
    expect(
      pickBestOtp(extractOtpCandidates("Your bank authentication code is 918273645012.")),
    ).toBe("918273645012");
  });

  it("normalizes spaced and hyphenated numeric groups", () => {
    expect(pickBestOtp(extractOtpCandidates("Your login code is 4 8 2 9 1 3"))).toBe("482913");
    expect(pickBestOtp(extractOtpCandidates("Confirmation code: 318-472"))).toBe("318472");
    expect(normalizeAuthCode("3 1 8 - 4 7 2", "numeric")).toBe("318472");
  });

  it("extracts alphanumeric codes with auth context", () => {
    expect(pickBestOtp(extractOtpCandidates("Your access code is AB12CD."))).toBe("AB12CD");
    expect(
      pickBestOtp(extractOtpCandidates("Enter device code WDJB-MJHT on github.com/login/device")),
    ).toBe("WDJB-MJHT");
  });

  it("ignores years, zip codes, and hex colors without OTP context", () => {
    const text =
      "Order placed in 2026. Ship to Austin, TX 78701. Brand color #FF5500 on file.";
    expect(pickBestOtp(extractOtpCandidates(text))).toBeNull();
  });

  it("still finds OTP when year/zip/color noise is present", () => {
    const text =
      "© 2026 SaaS Inc. ZIP 94107. Your security code is 883421. Color #00AAFF.";
    expect(pickBestOtp(extractOtpCandidates(text))).toBe("883421");
  });

  it("prefers OTP over bare order-looking numbers", () => {
    const text = "Order 10422 shipped. Your verification code is 551029.";
    expect(pickBestOtp(extractOtpCandidates(text))).toBe("551029");
  });

  it("handles G-XXXXXX Google-style codes", () => {
    expect(
      pickBestOtp(extractOtpCandidates("G-204918 is your Google verification code.")),
    ).toBe("204918");
  });

  it("matches many locales for verification phrasing", () => {
    const cases: Array<[string, string]> = [
      ["Ihr Bestätigungscode lautet 672901.", "672901"],
      ["Votre code de vérification est 339120.", "339120"],
      ["Tu código de verificación es 441122.", "441122"],
      ["O seu código de verificação é 556677.", "556677"],
      ["Il tuo codice di verifica è 778899.", "778899"],
      ["Je verificatiecode is 112233.", "112233"],
      ["Din verifieringskod är 334455.", "334455"],
      ["Ваш код подтверждения: 998877", "998877"],
      ["認証コードは 847291 です。", "847291"],
      ["인증 코드: 564738", "564738"],
      ["您的验证码是 192837", "192837"],
    ];
    for (const [text, otp] of cases) {
      expect(pickBestOtp(extractOtpCandidates(text)), text).toBe(otp);
    }
  });

  it("does not treat Shipping / pinned words as OTP context", () => {
    expect(
      pickBestOtp(
        extractOtpCandidates("Shipping to Austin, TX 78701. Order placed in 2026."),
      ),
    ).toBeNull();
  });

  it("does not treat random alphanumeric SKUs as codes without context", () => {
    expect(pickBestOtp(extractOtpCandidates("SKU AB12CD shipped yesterday."))).toBeNull();
  });

  it("respects allowAlphanumeric: false", () => {
    const text = "Your access code is AB12CD.";
    expect(pickBestOtp(extractOtpCandidates(text, { allowAlphanumeric: false }))).toBeNull();
  });
});
