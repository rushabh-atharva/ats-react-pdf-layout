import * as P from '@react-pdf/primitives';

export const NON_WRAP_TYPES = [P.Svg, P.Note, P.Image, P.Canvas];

export const canCauseBlankSpace = (node, prevNode, currentChildren) => {
  if (!('preventBlankSpace' in node.props)) return false;

  const prevNodeHasHeightOne = prevNode?.box?.height === 1;
  const childrenIsEmpty = currentChildren?.length === 0;

  // padding/margin case
  if (prevNodeHasHeightOne === true && childrenIsEmpty === false) {
    return true;
  }

  // gap between content case
  if (node.box.height > 791 && childrenIsEmpty === true) {
    return true;
  }

  return false;
};

const getWrap = (node, prevNode, currentChildren) => {
  if (NON_WRAP_TYPES.includes(node.type)) return false;

  if (!node.props) return true;

  if (canCauseBlankSpace(node, prevNode, currentChildren)) return true;

  return 'wrap' in node.props ? node.props.wrap : true;
};

export default getWrap;
