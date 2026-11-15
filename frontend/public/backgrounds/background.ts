export interface Background {
    name: string // shown in the picker
    file: string // file name inside frontend/public/backgrounds/
}

// To add a video: copy it into frontend/public/backgrounds/ and add one line here.
export const BACKGROUNDS: Background[] = [
    { name: 'Earth From Space', file: 'earth_from_space_small.mp4' },
    { name: 'Beautiful Earth', file: 'beatifulearth.mp4' },
    { name: 'Colorful Galaxy', file: 'colorful_galaxy.mp4' },
]

// How dark the layer over the video is (0 = none, 1 = black). Raise it if text is hard to read.
export const DIM = 0.45