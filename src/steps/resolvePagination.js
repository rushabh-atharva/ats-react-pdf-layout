/* eslint-disable no-continue */
/* eslint-disable prefer-destructuring */

import * as P from '@react-pdf/primitives';
import { isNil, omit, compose } from '@react-pdf/fns';

import isFixed from '../node/isFixed';
import splitText from '../text/splitText';
import splitNode from '../node/splitNode';
import canNodeWrap, {
  canCauseBlankSpace,
  NON_WRAP_TYPES,
} from '../node/getWrap';
import getWrapArea from '../page/getWrapArea';
import getContentArea from '../page/getContentArea';
import createInstances from '../node/createInstances';
import shouldNodeBreak from '../node/shouldBreak';
import resolveTextLayout from './resolveTextLayout';
import resolveInheritance from './resolveInheritance';
import { resolvePageDimensions } from './resolveDimensions';

const isText = node => node.type === P.Text;

// Prevent splitting elements by low decimal numbers
const SAFTY_THRESHOLD = 0.001;

const assingChildren = (children, node) =>
  Object.assign({}, node, { children });

const getTop = node => node.box?.top || 0;

const allFixed = nodes => nodes.every(isFixed);

const isDynamic = node => !isNil(node.props?.render);

const relayoutPage = compose(
  resolveTextLayout,
  resolveInheritance,
  resolvePageDimensions,
);

const splitNodes = (height, contentArea, nodes) => {
  const currentChildren = [];
  const nextChildren = [];

  for (let i = 0; i < nodes.length; i += 1) {
    const child = nodes[i];
    const futureNodes = nodes.slice(i + 1);
    const futureFixedNodes = futureNodes.filter(isFixed);

    const nodeTop = getTop(child);
    const nodeHeight = child.box.height;
    const isOutside = height <= nodeTop;
    const shouldBreak = shouldNodeBreak(child, futureNodes, height);

    const prevChild = nodes.length > 0 && i > 0 ? nodes[i - 1] : undefined;

    const isBlankSpaceAvailable = canCauseBlankSpace(
      child,
      prevChild,
      currentChildren,
    );
    const shouldSplit = height + SAFTY_THRESHOLD < nodeTop + nodeHeight;

    const canWrap = canNodeWrap(child, prevChild, currentChildren);
    const fitsInsidePage = nodeHeight <= contentArea;

    if (isFixed(child)) {
      nextChildren.push(child);
      currentChildren.push(child);
      continue;
    }

    if (isOutside) {
      const box = Object.assign({}, child.box, { top: child.box.top - height });
      const next = Object.assign({}, child, { box });
      nextChildren.push(next);
      continue;
    }

    if (!fitsInsidePage && !canWrap) {
      if (NON_WRAP_TYPES.includes(child.type)) {
        // We don't want to break non wrapable nodes, so we just let them be.
        // They will be cropped, user will need to fix their ~image usage?
        currentChildren.push(child);
        nextChildren.push(...futureNodes);
      } else {
        // We don't want to break non wrapable nodes, so we just let them be.
        const box = Object.assign({}, child.box, {
          top: child.box.top - height,
        });
        const props = Object.assign({}, child.props, {
          wrap: true,
          break: false,
        });
        const next = Object.assign({}, child, { box, props });

        currentChildren.push(...futureFixedNodes);
        nextChildren.push(next, ...futureNodes);
      }
      break;
    }

    if (shouldBreak) {
      const box = Object.assign({}, child.box, { top: child.box.top - height });
      const props = Object.assign({}, child.props, {
        wrap: true,
        break: false,
      });
      const next = Object.assign({}, child, { box, props });

      currentChildren.push(...futureFixedNodes);
      nextChildren.push(next, ...futureNodes);
      break;
    }

    if (shouldSplit) {
      const [currentChild, nextChild] = split(child, height, contentArea);

      // All children are moved to the next page, it doesn't make sense to show the parent on the current page
      // This was causing an infinite loop parent will now be discarded when it has no content
      if (child.children.length > 0 && currentChild.children.length === 0) {
        // if (currentChildren.length === 0) {
        //   currentChildren.push(child, ...futureFixedNodes);
        //   nextChildren.push(...futureNodes);
        // } else {
          const box = Object.assign({}, child.box, {
            top: child.box.top - height,
          });
          const next = Object.assign({}, nextChild, { box });

          currentChildren.push(...futureFixedNodes);
          nextChildren.push(next, ...futureNodes);
        // }
        break;
      }

      if (currentChild) currentChildren.push(currentChild);
      if (nextChild) nextChildren.push(nextChild);

      continue;
    }

    currentChildren.push(child);
  }

  return [currentChildren, nextChildren];
};

const splitChildren = (height, contentArea, node) => {
  const children = node.children || [];

  const availableHeight = height - getTop(node);

  return splitNodes(availableHeight, contentArea, children);
};

const splitView = (node, height, contentArea, foundBreakableViewChild) => {
  const [currentNode, nextNode] = splitNode(node, height);
  const [currentChilds, nextChildren] = splitChildren(
    height,
    contentArea,
    node,
    foundBreakableViewChild,
  );

  return [
    assingChildren(currentChilds, currentNode),
    assingChildren(nextChildren, nextNode),
  ];
};

const split = (node, height, contentArea, foundBreakableViewChild) =>
  isText(node)
    ? splitText(node, height)
    : splitView(node, height, contentArea, foundBreakableViewChild);

const shouldResolveDynamicNodes = node => {
  const children = node.children || [];
  return isDynamic(node) || children.some(shouldResolveDynamicNodes);
};

const resolveDynamicNodes = (props, node) => {
  const isNodeDynamic = isDynamic(node);

  // Call render prop on dynamic nodes and append result to children
  const resolveChildren = (children = []) => {
    if (isNodeDynamic) {
      const res = node.props.render(props);
      return createInstances(res)
        .filter(Boolean)
        .map(n => resolveDynamicNodes(props, n));
    }

    return children.map(c => resolveDynamicNodes(props, c));
  };

  // We reset dynamic text box so it can be computed again later on
  const resetHeight = isNodeDynamic && isText(node);
  const box = resetHeight ? { ...node.box, height: 0 } : node.box;

  const children = resolveChildren(node.children);
  const lines = isNodeDynamic ? null : node.lines;

  return Object.assign({}, node, { box, lines, children });
};

const resolveDynamicPage = (props, page, fontStore) => {
  if (shouldResolveDynamicNodes(page)) {
    const resolvedPage = resolveDynamicNodes(props, page);
    return relayoutPage(resolvedPage, fontStore);
  }

  return page;
};

const splitPage = (page, pageNumber, fontStore) => {
  const wrapArea = getWrapArea(page);
  const contentArea = getContentArea(page);
  const dynamicPage = resolveDynamicPage({ pageNumber }, page, fontStore);
  const height = page.style.height;

  const [currentChilds, nextChilds] = splitNodes(
    wrapArea,
    contentArea,
    dynamicPage.children,
  );

  const relayout = node => relayoutPage(node, fontStore);

  const currentBox = { ...page.box, height };
  const currentPage = relayout(
    Object.assign({}, page, { box: currentBox, children: currentChilds }),
  );

  if (nextChilds.length === 0 || allFixed(nextChilds))
    return [currentPage, null];

  const nextBox = omit('height', page.box);
  const nextProps = omit('bookmark', page.props);

  const nextPage = relayout(
    Object.assign({}, page, {
      props: nextProps,
      box: nextBox,
      children: nextChilds,
    }),
  );

  return [currentPage, nextPage];
};

const resolvePageIndices = (fontStore, page, pageNumber, pages) => {
  const totalPages = pages.length;

  const props = {
    totalPages,
    pageNumber: pageNumber + 1,
    subPageNumber: page.subPageNumber + 1,
    subPageTotalPages: page.subPageTotalPages,
  };

  return resolveDynamicPage(props, page, fontStore);
};

const assocSubPageData = subpages => {
  return subpages.map((page, i) => ({
    ...page,
    subPageNumber: i,
    subPageTotalPages: subpages.length,
  }));
};

const dissocSubPageData = page => {
  return omit(['subPageNumber', 'subPageTotalPages'], page);
};

const paginate = (page, pageNumber, fontStore) => {
  if (!page) return [];

  if (page.props?.wrap === false) return [page];

  let splittedPage = splitPage(page, pageNumber, fontStore);

  const pages = [splittedPage[0]];
  let nextPage = splittedPage[1];

  while (nextPage !== null) {
    splittedPage = splitPage(nextPage, pageNumber + pages.length, fontStore);

    pages.push(splittedPage[0]);
    nextPage = splittedPage[1];
  }

  return pages;
};

/**
 * Performs pagination. This is the step responsible of breaking the whole document
 * into pages following pagiation rules, such as `fixed`, `break` and dynamic nodes.
 *
 * @param {Object} node
 * @param {Object} fontStore font store
 * @returns {Object} layout node
 */
const resolvePagination = (doc, fontStore) => {
  let pages = [];
  let pageNumber = 1;

  for (let i = 0; i < doc.children.length; i += 1) {
    const page = doc.children[i];
    let subpages = paginate(page, pageNumber, fontStore);

    subpages = assocSubPageData(subpages);
    pageNumber += subpages.length;
    pages = pages.concat(subpages);
  }

  pages = pages.map((...args) =>
    dissocSubPageData(resolvePageIndices(fontStore, ...args)),
  );

  return assingChildren(pages, doc);
};

export default resolvePagination;
