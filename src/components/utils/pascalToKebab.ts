export function pascalToKebab(pascal: string): string {
  return pascal
    .replace(/([A-Z])/g, "-$1")
    .replace(/([a-zA-Z])([0-9])/g, "$1-$2")
    .replace(/([0-9])([a-zA-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/^-/, "")
    .replace(/-+/g, "-");
}
