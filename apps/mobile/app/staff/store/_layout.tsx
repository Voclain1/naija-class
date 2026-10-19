import { SectionStack } from "../../../src/components/section-stack";

// The school store (docs/modules/id-cards-and-store.md §4): a stack, so the
// tab bar stays underneath.
export default function StoreLayout() {
  return <SectionStack />;
}
