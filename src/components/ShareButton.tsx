import { CopyButton } from './CopyButton';

interface ShareButtonProps {
    url: string;
    ariaLabel: string;
    className?: string;
}

export function ShareButton({
    url,
    ariaLabel,
    className = '',
}: ShareButtonProps) {
    return (
        <CopyButton
            value={url}
            ariaLabel={ariaLabel}
            className={className}
            icon="share"
        />
    );
}
