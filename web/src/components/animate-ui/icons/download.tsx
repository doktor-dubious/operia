'use client';

import { motion, type Variants } from 'motion/react';

import {
  getVariants,
  useAnimateIconContext,
  IconWrapper,
  type IconProps,
} from '@/components/animate-ui/icons/icon';

type DownloadProps = IconProps<keyof typeof animations>;

const animations = {
  default: {
    group: {},
    tray: {},
    // Pilen + stammen dukker ned og tilbage — som en overførsel.
    arrow: {
      initial: { y: 0 },
      animate: {
        y: [0, 3, 0],
        transition: { duration: 0.5, ease: 'easeInOut' },
      },
    },
    stem: {
      initial: { y: 0 },
      animate: {
        y: [0, 3, 0],
        transition: { duration: 0.5, ease: 'easeInOut' },
      },
    },
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: DownloadProps) {
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
      <motion.path
        d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
        variants={variants.tray}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="m7 10 5 5 5-5"
        variants={variants.arrow}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="M12 15V3"
        variants={variants.stem}
        initial="initial"
        animate={controls}
      />
    </motion.svg>
  );
}

function Download(props: DownloadProps) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export {
  animations,
  Download,
  Download as DownloadIcon,
  type DownloadProps,
  type DownloadProps as DownloadIconProps,
};
