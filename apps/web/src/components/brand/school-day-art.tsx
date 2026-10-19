/** Decorative school-day illustration. No data, controls or accessible content. */
export function SchoolDayArt({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 300 260" fill="none" aria-hidden="true" focusable="false">
      <path d="M64 44C121 4 232 9 268 70C300 126 274 221 204 239C131 256 53 219 37 157C22 104 29 69 64 44Z" fill="#D2E3D1" />
      <circle cx="244" cy="57" r="21" fill="#F6D779" />
      <g transform="rotate(-12 160 152)">
        <rect x="62" y="159" width="179" height="37" rx="9" fill="#0E5C43" />
        <path d="M78 166H227V184H78C71 184 71 166 78 166Z" fill="#F7F5EF" />
        <rect x="83" y="123" width="168" height="38" rx="9" fill="#3FB68B" />
        <path d="M96 130H236V149H96C88 149 88 130 96 130Z" fill="#F7F5EF" />
        <path d="M87 77C114 68 138 73 157 87C179 75 203 73 226 83V133C201 124 180 128 157 141C135 126 112 124 87 133V77Z" fill="#FFFFFF" stroke="#0E5C43" strokeWidth="3" strokeLinejoin="round" />
        <path d="M157 87V141M104 89L139 95M104 101L139 107M175 94L211 90M175 106L211 102" stroke="#3FB68B" strokeWidth="3" strokeLinecap="round" />
        <path d="M190 129V162L200 155L210 163V126" fill="#E0A52E" />
      </g>
      <path d="M35 62C14 52 26 31 41 39C55 48 37 69 18 77" stroke="#0E5C43" strokeWidth="2" strokeLinecap="round" />
      <path d="M20 68L17 78L29 80M250 206V222M242 214H258" stroke="#0E5C43" strokeWidth="2" strokeLinecap="round" />
      <circle cx="56" cy="214" r="5" fill="#E0A52E" />
    </svg>
  );
}
