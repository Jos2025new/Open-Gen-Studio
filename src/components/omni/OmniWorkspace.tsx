import { OmniCanvas } from '../node/NodeWorkspace';

/** The omnicanvas (plan "todo es un nodo", step 12): the node canvas with the session's parts as nodes. It replaces the workspace; the chat is a node of it, so the composer dock is not drawn. */
export function OmniWorkspace() {
  return <OmniCanvas />;
}
