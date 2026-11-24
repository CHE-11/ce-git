const FIELDS = "input, textarea";
const FORMS = "form";

function isTextControl(element: Element): element is HTMLInputElement | HTMLTextAreaElement {
  if (element instanceof HTMLTextAreaElement) {
    return true;
  }
  if (!(element instanceof HTMLInputElement)) {
    return false;
  }
  const type = element.type;
  return type !== "hidden" && type !== "checkbox" && type !== "radio" && type !== "range" && type !== "file" && type !== "button" && type !== "submit" && type !== "reset" && type !== "color" && type !== "image";
}

function disableSuggestions(element: Element) {
  if (element instanceof HTMLFormElement) {
    element.autocomplete = "off";
    return;
  }
  if (!isTextControl(element)) {
    return;
  }
  element.autocomplete = element instanceof HTMLInputElement && element.type === "password" ? "new-password" : "off";
  element.spellcheck = false;
  element.setAttribute("autocorrect", "off");
  element.setAttribute("autocapitalize", "none");
  element.setAttribute("data-1p-ignore", "true");
  element.setAttribute("data-lpignore", "true");
  element.setAttribute("data-form-type", "other");
}

function apply(root: ParentNode) {
  if (root instanceof Element) {
    disableSuggestions(root);
  }
  root.querySelectorAll(`${FIELDS}, ${FORMS}`).forEach(disableSuggestions);
}

export function installDisableInputSuggestions() {
  const marker = Symbol.for("ce-git.disable-input-suggestions");
  const host = window as unknown as Record<symbol, boolean | undefined>;
  if (host[marker]) {
    return;
  }
  host[marker] = true;

  apply(document);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element) {
          apply(node);
        }
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
