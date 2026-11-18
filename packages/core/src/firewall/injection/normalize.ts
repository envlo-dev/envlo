export { normalizeVisibleText } from "./normalize-nfkc.js";
export {
  foldConfusables as foldCyrillicHomoglyphs,
  hasMixedScriptConfusables as detectMixedScriptHomoglyphs,
  stripInvisibleAndBidi,
  foldConfusables,
  hasMixedScriptConfusables,
} from "./confusables.js";
