import * as jsdom from 'jsdom';

export const findInTemplate = (templateContent: string, selector: string) => {
  const dom = new jsdom.JSDOM(templateContent);

  return {
    dom,
    result: dom.window.document.body.querySelectorAll(selector),
  };
}

export const attributesToArray = (attributes: NamedNodeMap) => {
  return [...attributes] as Attr[];
}

export const walkDom = function * (dom: jsdom.JSDOM) {
  const treeWalker = dom.window.document.createTreeWalker(dom.window.document.body, 1);
  while (treeWalker.nextNode()) {
    yield treeWalker.currentNode;
    treeWalker.nextNode();
  }
}
