'use client';

import { motion, type Variants } from 'motion/react';

import {
  getVariants,
  useAnimateIconContext,
  IconWrapper,
  type IconProps,
} from '@/components/animate-ui/icons/icon';

type Columns3Props = IconProps<keyof typeof animations>;

const animations = {
  default: {
    group: {},
    frame: {},
    // De to skillelinjer gentegnes forskudt — en let "kolonner"-effekt.
    line1: {
      initial: { pathLength: 1, opacity: 1 },
      animate: {
        pathLength: [0, 1],
        opacity: [0.4, 1],
        transition: { duration: 0.5, ease: 'easeInOut' },
      },
    },
    line2: {
      initial: { pathLength: 1, opacity: 1 },
      animate: {
        pathLength: [0, 1],
        opacity: [0.4, 1],
        transition: { duration: 0.5, ease: 'easeInOut', delay: 0.1 },
      },
    },
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: Columns3Props) {
  const { controls } = useAnimateIconContext();
  const variants = getVariants(animations);

  return (
    <motion.svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      variants={variants.group}
      initial="initial"
      animate={controls}
      {...props}
    >
      <motion.rect
        width="18"
        height="18"
        x="3"
        y="3"
        rx="2"
        variants={variants.frame}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="M9 3v18"
        variants={variants.line1}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="M15 3v18"
        variants={variants.line2}
        initial="initial"
        animate={controls}
      />
    </motion.svg>
  );
}

function Columns3(props: Columns3Props) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export {
  animations,
  Columns3,
  Columns3 as Columns3Icon,
  type Columns3Props,
  type Columns3Props as Columns3IconProps,
};
