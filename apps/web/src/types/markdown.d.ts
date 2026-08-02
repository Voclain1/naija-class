// See next.config.mjs's webpack() — `.md` imports are inlined as raw strings
// via webpack 5's `asset/source` module type.
declare module "*.md" {
  const content: string;
  export default content;
}
