// @ts-expect-error
import computeShader from "./compute.wgsl";

export function getMiningShader(): string {
  return computeShader;
}
