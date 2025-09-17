declare module "*.svg" {
  import * as React from "react";
  import { SVGProps } from "react";
  const ReactComponent: React.FunctionComponent<
    React.SVGProps<SVGSVGElement> & { title?: string }
  >;
  export default ReactComponent;
}