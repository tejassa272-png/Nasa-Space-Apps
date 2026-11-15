import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { Box3, Vector3 } from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';

const MODEL_URL = `${import.meta.env.BASE_URL}astronaut.glb`;

export default function HumanModel({ height }: { height: number }) {
  // This model uses uncompressed geometry and needs neither decoder.
  const { scene } = useGLTF(MODEL_URL, false, false);
  const model = useMemo(() => {
    const object = clone(scene);
    object.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(object, true);
    const size = bounds.getSize(new Vector3());
    const center = bounds.getCenter(new Vector3());

    object.traverse((node) => {
      // Skinned mesh bounds can be stale when the crew model is posed.
      node.frustumCulled = false;
    });

    return {
      object,
      offset: new Vector3(-center.x, -bounds.min.y, -center.z),
      scale: height / (size.y || 1),
    };
  }, [height, scene]);

  return (
    <group scale={model.scale}>
      <group position={model.offset}>
        <primitive object={model.object} />
      </group>
    </group>
  );
}
