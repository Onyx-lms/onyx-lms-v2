#!/usr/bin/env python3
"""
Q-04 acceptance: differential test of the grading engine.

The PHP algorithm from student/QuizController.php is transcribed here verbatim,
then thousands of generated submissions are scored by BOTH implementations and
compared. Any divergence is a port bug.

PHP reference (lines 36-72):
    mcq          empty(array_diff(correct, submitted)) && empty(array_diff(submitted, correct))
    fill_blanks  count equal, then strtolower(correct[i]) != strtolower(submitted[i]) -> false
    true_false   strtolower(json_encode(correct)) == strtolower(submitted)
"""
import json, random, subprocess, sys, os

HERE = os.path.dirname(os.path.abspath(__file__))
random.seed(20260809)  # deterministic


def php_json_decode(raw):
    if raw is None or raw == '':
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


def php_is_correct(qtype, stored_answer, submitted):
    """Faithful transcription of the PHP marking branch."""
    correct = php_json_decode(stored_answer)

    if qtype == 'mcq':
        if not isinstance(correct, list):
            return False
        sub = submitted if isinstance(submitted, list) else [submitted]
        # array_diff both directions (set semantics, as PHP array_diff compares values)
        a, b = set(map(str, correct)), set(map(str, sub))
        return not (a - b) and not (b - a)

    if qtype == 'fill_blanks':
        if not isinstance(correct, list):
            return False
        sub = submitted if isinstance(submitted, list) else [submitted]
        if len(correct) != len(sub):
            return False
        for i in range(len(correct)):
            if str(correct[i]).lower() != str(sub[i]).lower():
                return False
        return True

    if qtype == 'true_false':
        # json_encode(json_decode('true')) -> 'true'
        encoded = json.dumps(correct) if correct is not None else json.dumps(stored_answer)
        sub = submitted[0] if isinstance(submitted, list) else submitted
        return encoded.lower() == str(sub).lower()

    return False


WORDS = ['alpha', 'Beta', 'GAMMA', 'delta', 'paris', 'France', 'x', 'y', 'z']


def make_case(i):
    qtype = random.choice(['mcq', 'fill_blanks', 'true_false'])
    if qtype == 'mcq':
        pool = random.sample(WORDS, random.randint(2, 4))
        answer = random.sample(pool, random.randint(1, len(pool)))
        stored = json.dumps(answer)
        # Sometimes submit the right thing, sometimes shuffled, sometimes wrong.
        roll = random.random()
        if roll < 0.35:
            submitted = list(answer)
        elif roll < 0.6:
            submitted = list(reversed(answer))
        elif roll < 0.8:
            submitted = answer + [random.choice(WORDS)]
        else:
            submitted = answer[:-1] if len(answer) > 1 else [random.choice(WORDS)]
    elif qtype == 'fill_blanks':
        answer = random.sample(WORDS, random.randint(1, 3))
        stored = json.dumps(answer)
        roll = random.random()
        if roll < 0.35:
            submitted = list(answer)
        elif roll < 0.6:
            submitted = [w.upper() for w in answer]
        elif roll < 0.8:
            submitted = list(reversed(answer))
        else:
            submitted = answer[:-1]
    else:
        val = random.choice(['true', 'false'])
        stored = val
        submitted = random.choice(['true', 'false', 'TRUE', 'False'])
    return {'id': i, 'type': qtype, 'answer': stored, 'submitted': submitted}


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 500
    cases = [make_case(i + 1) for i in range(n)]

    payload = os.path.join(HERE, '..', 'grading-cases.json')
    with open(payload, 'w', encoding='utf-8') as f:
        json.dump(cases, f)

    ts_out = subprocess.run(
        ['node', os.path.join(HERE, 'grading-run.mjs'), payload],
        capture_output=True, text=True, cwd=os.path.join(HERE, '..'))
    if ts_out.returncode != 0:
        print('TS runner failed:', ts_out.stderr[:800]); return 1
    ts = json.loads(ts_out.stdout)

    mismatches = []
    for case in cases:
        php = php_is_correct(case['type'], case['answer'], case['submitted'])
        got = ts[str(case['id'])]
        if php != got:
            mismatches.append((case, php, got))

    os.remove(payload)
    print('cases compared :', n)
    print('agreements     :', n - len(mismatches))
    if mismatches:
        print('MISMATCHES     :', len(mismatches))
        for case, php, got in mismatches[:8]:
            print('  ', case['type'], 'stored=', case['answer'],
                  'submitted=', case['submitted'], '| php=', php, 'ts=', got)
        return 1
    print('\nDIFFERENTIAL PASS: the TypeScript engine scores identically to the PHP algorithm')
    return 0


if __name__ == '__main__':
    sys.exit(main())
